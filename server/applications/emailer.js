import path from 'node:path'
import { sendEmail } from '../email/smtp.js'
import { getCvState } from '../cv/storage.js'
import { detectRole } from '../radar/filter.js'
import { stableHash } from '../radar/hash.js'
import { loadCandidateProfiles, resolveProfileRuntime, selectCandidateProfile } from '../profiles/config.js'
import { renderApplicationTemplate } from './templates.js'
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
const SENT_STATUSES = new Set(['sent', 'sent_pending_delivery', 'delivered_or_no_bounce_after_grace_period'])

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
  const profiles = loadCandidateProfiles({ env })
  const legacyContext = profiles.length ? null : buildApplicationContext(getCvState())
  const cutoff = blockCutoff(now, env).toISOString()
  const recentSends = getRecentApplicationEmailSends(db, cutoff)
  const sentOfferKeys = new Set(recentSends
    .filter((row) => SENT_STATUSES.has(row.status))
    .map((row) => row.offerKey))
  const dayStart = startOfUtcDay(now).toISOString()
  let liveSendsToday = recentSends.filter((row) => row.sentAt >= dayStart && isAcceptedSend(row)).length
  const sendsTodayByProfile = countSendsTodayByProfile(recentSends, dayStart)
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

  const delivery = applicationDeliveryCheck(env)
  if (!delivery.allowed) {
    const result = { status: 'skipped', reason: delivery.reason }
    summary.skipped = source.offers.length
    summary.results = source.offers.map((offer) => ({ ...result, offerId: offer.id, offerTitle: offer.title }))
    logger.warn(`[applications] envoi ignore: ${delivery.reason}`)
    return summary
  }

  if (legacyContext && !legacyContext.ready) {
    const result = { status: 'skipped', reason: legacyContext.reason }
    summary.skipped = source.offers.length
    summary.results = source.offers.map((offer) => ({ ...result, offerId: offer.id, offerTitle: offer.title }))
    logger.warn(`[applications] envoi ignore: ${legacyContext.reason}`)
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

    const profile = profiles.length ? selectCandidateProfile(offer, profiles) : null
    if (profiles.length && !profile) {
      summary.skipped += 1
      summary.results.push({ status: 'skipped', reason: 'no_matching_profile', offerId: offer.id, offerKey, offerTitle: offer.title })
      logger.warn(`[applications] envoi ignore ${offer.id}: no_matching_profile`)
      continue
    }
    if (profile && profile.automaticOfferApplicationsEnabled !== true) {
      summary.skipped += 1
      summary.results.push({ status: 'skipped', reason: 'profile_automatic_offer_applications_disabled', offerId: offer.id, offerKey, offerTitle: offer.title, profilePseudo: profile.pseudo })
      logger.warn(`[applications] envoi ignore ${offer.id}: profile_automatic_offer_applications_disabled:${profile.pseudo}`)
      continue
    }
    const context = profile ? buildApplicationContextFromProfile(profile) : legacyContext
    if (!context.ready) {
      summary.skipped += 1
      summary.results.push({ status: 'skipped', reason: context.reason, offerId: offer.id, offerKey, offerTitle: offer.title, profilePseudo: context.profilePseudo })
      logger.warn(`[applications] envoi ignore ${offer.id}: ${context.reason}`)
      continue
    }
    if (profile && Number(sendsTodayByProfile.get(profile.pseudo) || 0) >= profile.dailyQuota) {
      summary.skipped += 1
      summary.results.push({ status: 'skipped', reason: 'profile_daily_limit_reached', offerId: offer.id, offerKey, offerTitle: offer.title, profilePseudo: profile.pseudo })
      continue
    }

    const message = buildApplicationMessage({ offer, context })

    const discovered = await discoverContactsForOffer(offer, { offerKey, env, now })
    upsertApplicationContacts(db, discovered, { now, profilePseudo: context.profilePseudo })
    let contacts = getApplicationContacts(db, offerKey, { profilePseudo: context.profilePseudo })
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
      const sendEnv = buildApplicationSmtpEnv(context, env)

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
        }, sendEnv)
        const row = {
          sentAt,
          profilePseudo: context.profilePseudo,
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
        updateApplicationContactStatus(db, { offerKey, email: contact.email, profilePseudo: context.profilePseudo, status: 'sent_pending_delivery', lastAttemptAt: sentAt, incrementAttempts: true })
        sentOfferKeys.add(offerKey)
        liveSendsToday += 1
        if (context.profilePseudo) sendsTodayByProfile.set(context.profilePseudo, Number(sendsTodayByProfile.get(context.profilePseudo) || 0) + 1)
        summary.sent += 1
        summary.results.push({ ...row, cvFileName: context.cvFileName })
        sent = true
      } catch (error) {
        const hardFailure = isHardSmtpFailure(error)
        const status = hardFailure ? 'invalid' : 'failed'
        const row = {
          sentAt,
          profilePseudo: context.profilePseudo,
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
          profilePseudo: context.profilePseudo,
          status,
          lastAttemptAt: sentAt,
          bounceReason: error.message,
          incrementAttempts: true,
        })
        immediateFailures += 1
        contacts = getApplicationContacts(db, offerKey, { profilePseudo: context.profilePseudo })
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
  if (context.applicationMail.dynamicTemplate) {
    const rendered = renderApplicationTemplate({ offer, context, offerUrl })
    return {
      subject: rendered.subject,
      text: ensureOfferUrlLine(rendered.text, offerUrl),
      roleType: rendered.roleType,
      angle: rendered.angle,
    }
  }
  return {
    subject: renderTemplate(context.applicationMail.subjectTemplate, title, offerUrl),
    text: ensureOfferUrlLine(renderTemplate(context.applicationMail.bodyTemplate, title, offerUrl), offerUrl),
  }
}

export async function sendApplicationTestEmail({ to, profilePseudo = '', env = process.env, mailer = sendEmail } = {}) {
  const recipient = String(to || '').trim()
  if (!recipient) throw new Error('Destinataire manquant.')

  const profiles = loadCandidateProfiles({ env })
  const profile = profiles.find((item) => item.pseudo === String(profilePseudo || '').trim())
  if (profile && profile.automaticOfferApplicationsEnabled !== true) {
    const error = new Error('profile_automatic_offer_applications_disabled')
    error.status = 403
    throw error
  }
  const context = profile
    ? buildApplicationContextFromProfile(profile)
    : buildApplicationContext(getCvState({ pseudo: profilePseudo }))
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
  }, buildApplicationSmtpEnv(context, env))

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
    profilePseudo: cvState.pseudo || '',
    emailFrom: '',
    cvFileName: activeFile,
    cvPath,
    applicationMail: hydrateIdentity(applicationMail),
  }
}

export function buildApplicationContextFromProfile(profile) {
  const runtime = resolveProfileRuntime(profile)
  const cvState = getCvState({ pseudo: runtime.pseudo })
  const profileMail = cvState.applicationMail?.configured ? cvState.applicationMail : {}
  const activeFile = cvState.activeFile || ''
  const cvPath = activeFile ? path.join(cvState.storageDir, activeFile) : runtime.cvPath
  const applicationMail = {
    firstName: profileMail.firstName || runtime.firstName,
    lastName: profileMail.lastName || runtime.lastName,
    phone: profileMail.phone || runtime.phone || '',
    dynamicTemplate: runtime.template,
    spontaneousTemplate: runtime.spontaneousTemplate,
    targetRoles: runtime.targetRoles || [],
    targetRoleLabels: runtime.targetRoleLabels || [],
  }
  const missing = []
  if (!applicationMail.firstName) missing.push('prenom manquant')
  if (!applicationMail.lastName) missing.push('nom manquant')
  if (!cvPath) missing.push('CV manquant')
  else if (!activeFile && !runtime.ready && runtime.reason.includes('CV')) missing.push(runtime.reason)

  const ready = (runtime.ready || Boolean(activeFile)) ? missing.length === 0 : runtime.ready

  return {
    ready,
    reason: ready ? '' : (missing.length ? missing.join(', ') : runtime.reason),
    profilePseudo: runtime.pseudo,
    emailFrom: runtime.emailFrom,
    smtpPrefix: runtime.smtpPrefix,
    cvFileName: activeFile || runtime.cvFileName,
    cvPath,
    applicationMail,
  }
}

export function buildApplicationSmtpEnv(context, env = process.env) {
  const base = context?.emailFrom ? { ...env, APPLICATION_FROM: context.emailFrom } : { ...env }
  const prefix = String(context?.smtpPrefix || '').trim()
  if (!prefix) return base

  const prefixed = (name) => env[`${prefix}_${name}`]
  const from = prefixed('APPLICATION_FROM') || prefixed('MAIL_FROM') || context?.emailFrom
  return {
    ...base,
    SMTP_HOST: prefixed('SMTP_HOST') || base.SMTP_HOST,
    SMTP_PORT: prefixed('SMTP_PORT') || base.SMTP_PORT,
    SMTP_SECURE: prefixed('SMTP_SECURE') || base.SMTP_SECURE,
    SMTP_USER: prefixed('SMTP_USER') || base.SMTP_USER,
    SMTP_PASSWORD: prefixed('SMTP_PASSWORD') || prefixed('SMTP_PASS') || base.SMTP_PASSWORD,
    APPLICATION_FROM: from || base.APPLICATION_FROM,
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
  const mode = String(env.APPLICATION_EMAIL_DELIVERY_MODE || 'live').toLowerCase()
  const redirectTo = String(env.APPLICATION_EMAIL_REDIRECT_TO || '').trim()
  if (mode !== 'live') return redirectTo
  return originalRecipients.length === 1 ? originalRecipients[0] : originalRecipients
}

export function applicationDeliveryCheck(env = process.env) {
  const mode = String(env.APPLICATION_EMAIL_DELIVERY_MODE || 'live').toLowerCase()
  const redirectTo = String(env.APPLICATION_EMAIL_REDIRECT_TO || '').trim()
  if (mode === 'live' || redirectTo) return { allowed: true, reason: '' }
  return { allowed: false, reason: 'test_redirect_missing' }
}

function normalizedEmails(emails) {
  return Array.from(new Set((emails || []).map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))).sort()
}

function isApplicationCandidateOffer(offer, { now, env }) {
  const status = offer.evaluation?.status || ''
  if (offer.verdict === 'à rejeter' || status === 'à rejeter') return false
  const role = detectRole(String(offer.title || ''), String(offer.title || ''))
  if (role.status !== 'clear' && role.status !== 'compatible') return false
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

function countSendsTodayByProfile(sends, dayStart) {
  const counts = new Map()
  for (const row of sends) {
    if (row.sentAt < dayStart || !isAcceptedSend(row)) continue
    const pseudo = String(row.profilePseudo || '').trim()
    if (!pseudo) continue
    counts.set(pseudo, Number(counts.get(pseudo) || 0) + 1)
  }
  return counts
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
