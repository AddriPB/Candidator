import path from 'node:path'
import { sendEmail } from '../email/smtp.js'
import { getCvState } from '../cv/storage.js'
import { stableHash } from '../radar/hash.js'
import { chooseNextContact, discoverContactsForOffer } from './contactDiscovery.js'
import {
  getApplicationCandidateOffers,
  getApplicationContacts,
  getApplicationEmailSends,
  getRecentApplicationEmailSends,
  saveApplicationEmailSend,
  updateApplicationContactStatus,
  upsertApplicationContacts,
} from '../storage/database.js'

const TITLE_PLACEHOLDER = '[Intitulé du poste]'
const OFFER_URL_PLACEHOLDER = '[URL de l’offre]'
const TEST_RECIPIENT = 'adri538.mail@gmail.com'

export async function sendDailyApplicationEmails({
  db,
  offers = null,
  startedAt = null,
  now = new Date(),
  env = process.env,
  mailer = sendEmail,
  logger = console,
} = {}) {
  if (!db) throw new Error('Base de donnees manquante.')

  const source = offers ? { startedAt, offers: offers.filter((offer) => isApplicationCandidateOffer(offer, { now, env })) } : getApplicationCandidateOffers(db, { now })
  const cvState = getCvState()
  const context = buildApplicationContext(cvState)
  const cutoff = blockCutoff(now, env).toISOString()
  const recentSends = getRecentApplicationEmailSends(db, cutoff)
  const sentOfferKeys = new Set(recentSends
    .filter((row) => ['sent', 'sent_pending_delivery', 'delivered_or_no_bounce_after_grace_period'].includes(row.status))
    .map((row) => row.offerKey))
  const dayStart = startOfUtcDay(now).toISOString()
  let liveSendsToday = recentSends.filter((row) => row.sentAt >= dayStart && isAcceptedSend(row)).length
  const dailyLimit = positiveInteger(env.APPLICATION_EMAIL_DAILY_LIMIT, 20)

  const summary = {
    startedAt: source.startedAt || null,
    candidates: source.offers.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    results: [],
  }

  const sendWindow = applicationSendWindow(now, env)
  if (!sendWindow.allowed) {
    const result = { status: 'skipped', reason: sendWindow.reason }
    summary.skipped = source.offers.length
    summary.results = source.offers.map((offer) => ({ ...result, offerId: offer.id, offerTitle: offer.title }))
    logger.warn(`[applications] envoi ignore: ${sendWindow.reason}`)
    return summary
  }

  if (!context.ready) {
    const result = { status: 'skipped', reason: context.reason }
    summary.skipped = source.offers.length
    summary.results = source.offers.map((offer) => ({ ...result, offerId: offer.id, offerTitle: offer.title }))
    logger.warn(`[applications] envoi ignore: ${context.reason}`)
    return summary
  }

  for (const offer of source.offers) {
    const offerKey = applicationOfferKey(offer)
    if (sentOfferKeys.has(offerKey)) {
      summary.skipped += 1
      summary.results.push({ status: 'skipped', reason: 'already_sent_recently', offerId: offer.id, offerKey, offerTitle: offer.title })
      continue
    }
    if (liveSendsToday >= dailyLimit) {
      summary.skipped += 1
      summary.results.push({ status: 'skipped', reason: 'daily_limit_reached', offerId: offer.id, offerKey, offerTitle: offer.title })
      continue
    }

    const message = buildApplicationMessage({ offer, context })

    const discovered = await discoverContactsForOffer(offer, { offerKey, env, now })
    upsertApplicationContacts(db, discovered, { now })
    let contacts = getApplicationContacts(db, offerKey)
    if (contacts.length === 0) {
      summary.skipped += 1
      summary.results.push({ status: 'skipped', reason: 'no_contact_found', offerId: offer.id, offerKey, offerTitle: offer.title })
      continue
    }

    let sent = false
    let immediateFailures = 0
    while (!sent && liveSendsToday < dailyLimit) {
      const sends = getApplicationEmailSends(db, { since: cutoff }).filter((row) => row.offerKey === offerKey)
      const contact = chooseNextContact({ contacts, sends, now, env })
      if (!contact) break

      const sentAt = now.toISOString()
      const attemptId = buildAttemptId({ offerKey, email: contact.email, now })
      const sentTo = applicationRecipient([contact.email], env)
      const bounceAddress = buildBounceAddress(attemptId, env)

      try {
        const result = await mailer({
          to: sentTo,
          subject: message.subject,
          text: message.text,
          attachments: [
            {
              filename: context.cvFileName,
              path: context.cvPath,
            },
          ],
          ...(bounceAddress ? {
            envelope: { from: bounceAddress, to: Array.isArray(sentTo) ? sentTo : [sentTo] },
            dsn: { id: attemptId, return: 'headers', notify: ['failure', 'delay'], recipient: contact.email },
          } : {}),
        }, env)
        const row = {
          sentAt,
          offerKey,
          offerId: String(offer.id || ''),
          offerTitle: String(offer.title || ''),
          company: String(offer.company || ''),
          originalTo: contact.email,
          sentTo: Array.isArray(sentTo) ? sentTo.join(', ') : sentTo,
          subject: message.subject,
          messageId: result?.messageId || '',
          attemptId,
          contactEmail: contact.email,
          status: 'sent_pending_delivery',
          error: '',
        }
        saveApplicationEmailSend(db, row)
        updateApplicationContactStatus(db, { offerKey, email: contact.email, status: 'sent_pending_delivery', lastAttemptAt: sentAt, incrementAttempts: true })
        sentOfferKeys.add(offerKey)
        liveSendsToday += 1
        summary.sent += 1
        summary.results.push({ ...row, cvFileName: context.cvFileName })
        sent = true
      } catch (error) {
        const hardFailure = isHardSmtpFailure(error)
        const status = hardFailure ? 'invalid' : 'failed'
        const row = {
          sentAt,
          offerKey,
          offerId: String(offer.id || ''),
          offerTitle: String(offer.title || ''),
          company: String(offer.company || ''),
          originalTo: contact.email,
          sentTo: Array.isArray(sentTo) ? sentTo.join(', ') : sentTo,
          subject: message.subject,
          messageId: '',
          attemptId,
          contactEmail: contact.email,
          status,
          error: error.message,
        }
        saveApplicationEmailSend(db, row)
        updateApplicationContactStatus(db, {
          offerKey,
          email: contact.email,
          status,
          lastAttemptAt: sentAt,
          bounceReason: error.message,
          incrementAttempts: true,
        })
        immediateFailures += 1
        contacts = getApplicationContacts(db, offerKey)
        if (!hardFailure) {
          summary.failed += 1
          summary.results.push(row)
          logger.error(`[applications] echec envoi ${offer.id}: ${error.message}`)
          break
        }
        summary.results.push(row)
      }
    }

    if (!sent && immediateFailures > 0) {
      summary.failed += 1
    } else if (!sent) {
      summary.skipped += 1
      summary.results.push({ status: 'skipped', reason: 'no_contact_available', offerId: offer.id, offerKey, offerTitle: offer.title })
    }
  }

  logger.log(`[applications] ${summary.sent} envoye(s), ${summary.skipped} ignore(s), ${summary.failed} echec(s)`)
  return summary
}

export function buildApplicationMessage({ offer, context }) {
  const title = String(offer.title || '').trim() || 'poste propose'
  const offerUrl = applicationOfferUrl(offer)
  return {
    subject: renderTemplate(context.applicationMail.subjectTemplate, title, offerUrl),
    text: ensureOfferUrlLine(renderTemplate(context.applicationMail.bodyTemplate, title, offerUrl), offerUrl),
  }
}

export async function sendApplicationTestEmail({ to, env = process.env, mailer = sendEmail } = {}) {
  const recipient = String(to || '').trim()
  if (!recipient) throw new Error('Destinataire manquant.')

  const cvState = getCvState()
  const context = buildApplicationContext(cvState)
  if (!context.ready) throw new Error(context.reason)

  const offer = {
    id: `manual-test:${Date.now()}`,
    title: 'Test Opportunity Radar',
    company: 'Test',
    emails: [recipient],
  }
  const message = buildApplicationMessage({ offer, context })
  const result = await mailer({
    to: recipient,
    subject: message.subject,
    text: message.text,
    attachments: [
      {
        filename: context.cvFileName,
        path: context.cvPath,
      },
    ],
  }, env)

  return {
    to: recipient,
    subject: message.subject,
    messageId: result?.messageId || '',
    cvFileName: context.cvFileName,
  }
}

export function applicationOfferKey(offer) {
  if (offer.link) return `link:${normalizeUrl(offer.link)}`
  if (offer.id) return `id:${offer.id}`
  return `hash:${stableHash([
    offer.title,
    offer.company,
    offer.location,
    offer.source,
    String(offer.description || '').slice(0, 180),
  ].join('|'))}`
}

export function buildApplicationContext(cvState) {
  const activeFile = cvState.activeFile || ''
  const cvPath = activeFile ? path.join(cvState.storageDir, activeFile) : ''
  const applicationMail = cvState.applicationMail || {}
  const missing = []
  if (!activeFile) missing.push('CV actif manquant')
  if (!applicationMail.firstName) missing.push('prenom manquant')
  if (!applicationMail.lastName) missing.push('nom manquant')
  if (!applicationMail.phone) missing.push('telephone manquant')

  return {
    ready: missing.length === 0,
    reason: missing.join(', '),
    cvFileName: activeFile,
    cvPath,
    applicationMail: hydrateIdentity(applicationMail),
  }
}

function hydrateIdentity(applicationMail) {
  const signature = [applicationMail.firstName, applicationMail.lastName].filter(Boolean).join(' ').trim()
  return {
    ...applicationMail,
    bodyTemplate: String(applicationMail.bodyTemplate || '')
      .replaceAll('[Téléphone]', String(applicationMail.phone || '').trim() || '[Téléphone]')
      .replaceAll('[Prénom Nom]', signature || '[Prénom Nom]'),
  }
}

function renderTemplate(template, title, offerUrl = '') {
  return String(template || '')
    .replaceAll(TITLE_PLACEHOLDER, title)
    .replaceAll(OFFER_URL_PLACEHOLDER, offerUrl)
}

function ensureOfferUrlLine(text, offerUrl) {
  if (!offerUrl || text.includes('Offre concernée :')) return text
  if (text.includes('Vous trouverez mon CV en pièce jointe.')) {
    return text.replace('Vous trouverez mon CV en pièce jointe.', `Offre concernée : ${offerUrl}\n\nVous trouverez mon CV en pièce jointe.`)
  }
  return `${text.trim()}\n\nOffre concernée : ${offerUrl}`
}

function applicationOfferUrl(offer) {
  const raw = offer.raw || {}
  return [
    offer.link,
    raw.urlPostulation,
    raw.origineOffre?.urlOrigine,
    raw.contact?.urlPostulation,
    raw.url,
    raw.redirect_url,
  ].find((value) => /^https?:\/\//i.test(String(value || '').trim())) || ''
}

export function applicationRecipient(originalRecipients, env) {
  const mode = String(env.APPLICATION_EMAIL_DELIVERY_MODE || 'test').toLowerCase()
  const redirectTo = String(env.APPLICATION_EMAIL_REDIRECT_TO || TEST_RECIPIENT).trim()
  if (mode !== 'live') return redirectTo
  return originalRecipients.length === 1 ? originalRecipients[0] : originalRecipients
}

function normalizedEmails(emails) {
  return Array.from(new Set((emails || []).map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))).sort()
}

function isApplicationCandidateOffer(offer, { now, env }) {
  const status = offer.evaluation?.status || ''
  if (offer.verdict === 'à rejeter' || status === 'à rejeter') return false
  const date = new Date(offer.publishedAt || offer.collectedAt || '')
  if (Number.isNaN(date.getTime())) return false
  return date >= offerWindowStart(now, env) && date <= now
}

function blockCutoff(now, env) {
  const months = Number(env.APPLICATION_EMAIL_BLOCK_MONTHS || 12)
  const safeMonths = Number.isFinite(months) && months > 0 ? months : 12
  return new Date(now.getTime() - safeMonths * 31 * 24 * 60 * 60 * 1000)
}

function offerWindowStart(now, env) {
  const months = Number(env.APPLICATION_EMAIL_OFFER_MAX_MONTHS || 12)
  const safeMonths = Number.isFinite(months) && months > 0 ? months : 12
  return new Date(now.getTime() - safeMonths * 31 * 24 * 60 * 60 * 1000)
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return String(url || '').trim().toLowerCase()
  }
}

export function buildAttemptId({ offerKey, email, now }) {
  return stableHash(`${offerKey}|${email}|${now.toISOString()}|${Math.random()}`).slice(0, 24)
}

export function buildBounceAddress(attemptId, env) {
  const base = String(env.APPLICATION_EMAIL_BOUNCE_ADDRESS || '').trim()
  if (!base || !base.includes('@')) return ''
  const [local, domain] = base.split('@')
  return `${local}+${attemptId}@${domain}`
}

export function isHardSmtpFailure(error) {
  const responseCode = Number(error?.responseCode)
  if (Number.isFinite(responseCode) && responseCode >= 500 && responseCode < 600) return true
  return /\b5\.\d+\.\d+\b|\b55\d\b|user unknown|mailbox unavailable|invalid recipient/i.test(String(error?.message || ''))
}

export function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function isAcceptedSend(row) {
  return ['sent_pending_delivery', 'hard_bounced', 'soft_bounced', 'retry_scheduled', 'delivered_or_no_bounce_after_grace_period'].includes(row.status)
}

export function applicationSendWindow(now, env) {
  const timezone = String(env.APPLICATION_EMAIL_SEND_TIMEZONE || 'Europe/Paris')
  const startHour = boundedHour(env.APPLICATION_EMAIL_SEND_START_HOUR, 8)
  const endHour = boundedHour(env.APPLICATION_EMAIL_SEND_END_HOUR, 21)
  const local = localTimeParts(now, timezone)
  const currentMinutes = local.hour * 60 + local.minute
  const startMinutes = startHour * 60
  const endMinutes = endHour * 60
  const allowed = currentMinutes >= startMinutes && currentMinutes < endMinutes
  return {
    allowed,
    reason: allowed ? '' : `outside_send_window_${timezone}_${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00`,
  }
}

function boundedHour(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= 24 ? number : fallback
}

function localTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}
