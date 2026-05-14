import path from 'node:path'
import { sendEmail } from '../email/smtp.js'
import { getCvState } from '../cv/storage.js'
import { stableHash } from '../radar/hash.js'
import {
  getApplicationEmailEligibleOffers,
  getRecentApplicationEmailSends,
  saveApplicationEmailSend,
} from '../storage/database.js'

const TITLE_PLACEHOLDER = '[Intitulé du poste]'
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

  const source = offers ? { startedAt, offers: offers.filter((offer) => isApplicationEmailEligibleOffer(offer, { now, env })) } : getApplicationEmailEligibleOffers(db, { now })
  const cvState = getCvState()
  const context = buildApplicationContext(cvState)
  const cutoff = blockCutoff(now, env).toISOString()
  const sentOfferKeys = new Set(getRecentApplicationEmailSends(db, cutoff)
    .filter((row) => row.status === 'sent')
    .map((row) => row.offerKey))

  const summary = {
    startedAt: source.startedAt || null,
    candidates: source.offers.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    results: [],
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

    const originalRecipients = normalizedEmails(offer.emails)
    const sentTo = applicationRecipient(originalRecipients, env)
    const message = buildApplicationMessage({ offer, context })
    const sentAt = now.toISOString()

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
      }, env)
      const row = {
        sentAt,
        offerKey,
        offerId: String(offer.id || ''),
        offerTitle: String(offer.title || ''),
        company: String(offer.company || ''),
        originalTo: originalRecipients.join(', '),
        sentTo: Array.isArray(sentTo) ? sentTo.join(', ') : sentTo,
        subject: message.subject,
        messageId: result?.messageId || '',
        status: 'sent',
        error: '',
      }
      saveApplicationEmailSend(db, row)
      sentOfferKeys.add(offerKey)
      summary.sent += 1
      summary.results.push({ ...row, cvFileName: context.cvFileName })
    } catch (error) {
      const row = {
        sentAt,
        offerKey,
        offerId: String(offer.id || ''),
        offerTitle: String(offer.title || ''),
        company: String(offer.company || ''),
        originalTo: originalRecipients.join(', '),
        sentTo: Array.isArray(sentTo) ? sentTo.join(', ') : sentTo,
        subject: message.subject,
        messageId: '',
        status: 'failed',
        error: error.message,
      }
      saveApplicationEmailSend(db, row)
      summary.failed += 1
      summary.results.push(row)
      logger.error(`[applications] echec envoi ${offer.id}: ${error.message}`)
    }
  }

  logger.log(`[applications] ${summary.sent} envoye(s), ${summary.skipped} ignore(s), ${summary.failed} echec(s)`)
  return summary
}

export function buildApplicationMessage({ offer, context }) {
  const title = String(offer.title || '').trim() || 'poste propose'
  return {
    subject: renderTemplate(context.applicationMail.subjectTemplate, title),
    text: renderTemplate(context.applicationMail.bodyTemplate, title),
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

function buildApplicationContext(cvState) {
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

function renderTemplate(template, title) {
  return String(template || '').replaceAll(TITLE_PLACEHOLDER, title)
}

function applicationRecipient(originalRecipients, env) {
  const mode = String(env.APPLICATION_EMAIL_DELIVERY_MODE || 'test').toLowerCase()
  const redirectTo = String(env.APPLICATION_EMAIL_REDIRECT_TO || TEST_RECIPIENT).trim()
  if (mode !== 'live') return redirectTo
  return originalRecipients
}

function normalizedEmails(emails) {
  return Array.from(new Set((emails || []).map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))).sort()
}

function isApplicationEmailEligibleOffer(offer, { now, env }) {
  const status = offer.evaluation?.status || ''
  if (offer.verdict === 'à rejeter' || status === 'à rejeter') return false
  if (normalizedEmails(offer.emails).length === 0) return false
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
