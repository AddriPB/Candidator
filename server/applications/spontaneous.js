import { sendEmail } from '../email/smtp.js'
import { getCvState } from '../cv/storage.js'
import { discoverContactsForOffer, isValidContactEmail, normalizeEmail } from './contactDiscovery.js'
import {
  getAllApplicationContacts,
  getApplicationCandidateOffers,
  getApplicationContacts,
  getApplicationEmailSends,
  saveApplicationEmailSend,
  updateApplicationContactStatus,
  upsertApplicationContacts,
} from '../storage/database.js'
import {
  applicationOfferKey,
  applicationRecipient,
  applicationSendWindow,
  buildApplicationContext,
  buildAttemptId,
  buildBounceAddress,
  isHardSmtpFailure,
  positiveInteger,
} from './emailer.js'

export const SPONTANEOUS_APPLICATION = 'spontaneous_application'

const SUCCESS_STATUSES = new Set([
  'sent',
  'sent_pending_delivery',
  'delivered_or_no_bounce_after_grace_period',
  'hard_bounced',
  'soft_bounced',
  'retry_scheduled',
])

export async function sendDailySpontaneousApplications({
  db,
  offers = null,
  startedAt = null,
  now = new Date(),
  env = process.env,
  mailer = sendEmail,
  logger = console,
} = {}) {
  if (!db) throw new Error('Base de donnees manquante.')

  const cvState = getCvState()
  const context = buildApplicationContext(cvState)
  const sendWindow = spontaneousSendWindow(now, env)
  const source = offers ? { startedAt, offers } : getApplicationCandidateOffers(db, { now })
  const since = new Date(now.getTime() - positiveInteger(env.APPLICATION_EMAIL_BLOCK_MONTHS, 12) * 31 * 24 * 60 * 60 * 1000).toISOString()
  const allSends = getApplicationEmailSends(db, { since })
  const spontaneousSends = allSends.filter((row) => row.actionType === SPONTANEOUS_APPLICATION)
  const daySends = spontaneousSends.filter((row) => sameLocalDay(row.sentAt, now, spontaneousTimezone(env)))
  const successfulEmails = new Set(spontaneousSends.filter((row) => SUCCESS_STATUSES.has(row.status)).map((row) => normalizeEmail(row.contactEmail || row.originalTo)))
  const successToday = daySends.some((row) => SUCCESS_STATUSES.has(row.status))
  const failuresToday = daySends.filter((row) => row.status === 'failed' || row.status === 'invalid').length

  const summary = {
    startedAt: source.startedAt || null,
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    results: [],
  }

  if (!sendWindow.allowed) {
    return stopWithSkip({ db, summary, now, reason: sendWindow.reason, dailyStopReason: sendWindow.reason, logger })
  }

  if (!context.ready) {
    return stopWithSkip({ db, summary, now, reason: context.reason, dailyStopReason: context.reason, logger })
  }

  if (successToday) {
    return stopWithSkip({ db, summary, now, reason: 'daily_success_already_reached', dailyStopReason: 'stop_after_1_success', logger })
  }

  if (failuresToday >= 3) {
    return stopWithSkip({ db, summary, now, reason: 'daily_failure_cap_reached', dailyStopReason: 'stop_after_3_failures', logger })
  }

  const targets = await collectSpontaneousTargets({ db, offers: source.offers, env, now })
  summary.candidates = targets.length
  let attemptOfDay = failuresToday

  while (attemptOfDay < 3) {
    const target = chooseSpontaneousTarget({ targets, successfulEmails, spontaneousSends, now, env })
    if (!target) {
      summary.skipped += 1
      summary.results.push(buildSpontaneousLog({
        now,
        target: null,
        status: 'skipped',
        reason: 'no_contact_available',
        attemptOfDay,
      }))
      break
    }

    attemptOfDay += 1
    const sentAt = now.toISOString()
    const attemptId = buildAttemptId({ offerKey: target.key, email: target.email, now })
    const sentTo = applicationRecipient([target.email], env)
    const bounceAddress = buildBounceAddress(attemptId, env)
    const message = buildSpontaneousApplicationMessage({ context })

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
          dsn: { id: attemptId, return: 'headers', notify: ['failure', 'delay'], recipient: target.email },
        } : {}),
      }, env)

      const row = buildSpontaneousLog({
        now,
        sentAt,
        target,
        status: 'sent_pending_delivery',
        messageId: result?.messageId || '',
        attemptId,
        sentTo,
        subject: message.subject,
        attemptOfDay,
        dailyStopReason: 'stop_after_1_success',
      })
      saveApplicationEmailSend(db, row)
      updateApplicationContactStatus(db, { offerKey: target.offerKey, email: target.email, status: 'sent_pending_delivery', lastAttemptAt: sentAt, incrementAttempts: true })
      summary.sent += 1
      summary.results.push({ ...row, cvFileName: context.cvFileName })
      logger.log('[spontaneous_application] 1 envoye, arret journalier')
      return summary
    } catch (error) {
      const status = isHardSmtpFailure(error) ? 'invalid' : 'failed'
      const dailyStopReason = attemptOfDay >= 3 ? 'stop_after_3_failures' : ''
      const row = buildSpontaneousLog({
        now,
        sentAt,
        target,
        status,
        error: error.message,
        attemptId,
        sentTo,
        subject: message.subject,
        attemptOfDay,
        dailyStopReason,
      })
      saveApplicationEmailSend(db, row)
      updateApplicationContactStatus(db, {
        offerKey: target.offerKey,
        email: target.email,
        status,
        lastAttemptAt: sentAt,
        bounceReason: error.message,
        incrementAttempts: true,
      })
      summary.failed += 1
      summary.results.push(row)
      logger.error(`[spontaneous_application] echec ${target.email}: ${error.message}`)
      if (attemptOfDay >= 3) return summary
    }
  }

  return summary
}

export function buildSpontaneousApplicationMessage({ context }) {
  const mail = context.applicationMail || {}
  const signature = [mail.firstName, mail.lastName].filter(Boolean).join(' ').trim()
  return {
    subject: 'Candidature spontanée',
    text: `Bonjour,

Je vous adresse ma candidature spontanée pour des postes de Product Owner, Business Analyst ou Chef de projet MOA / AMOA.

Vous trouverez mon CV en pièce jointe. Je suis disponible pour échanger par téléphone afin de vous présenter mon profil.

Vous pouvez me joindre au ${mail.phone}.

Bien cordialement,
${signature}`,
  }
}

export function spontaneousSendWindow(now, env = process.env) {
  return applicationSendWindow(now, {
    ...env,
    APPLICATION_EMAIL_SEND_TIMEZONE: spontaneousTimezone(env),
    APPLICATION_EMAIL_SEND_START_HOUR: env.SPONTANEOUS_APPLICATION_SEND_START_HOUR ?? 8,
    APPLICATION_EMAIL_SEND_END_HOUR: env.SPONTANEOUS_APPLICATION_SEND_END_HOUR ?? 22,
  })
}

async function collectSpontaneousTargets({ db, offers, env, now }) {
  for (const offer of offers) {
    const offerKey = applicationOfferKey(offer)
    const contacts = await discoverContactsForOffer(offer, { offerKey, env, now })
    upsertApplicationContacts(db, contacts, { now })
  }

  const offersByKey = new Map(offers.map((offer) => [applicationOfferKey(offer), offer]))
  const contacts = getAllApplicationContacts(db)
  const targets = []
  const seen = new Set()
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email)
    if (!isValidContactEmail(email) || seen.has(email)) continue
    const offer = offersByKey.get(contact.offerKey)
    const company = String(offer?.company || '').trim()
    if (!company) continue
    seen.add(email)
    targets.push({
      key: `spontaneous:${email}`,
      offerKey: contact.offerKey,
      company,
      contactName: contact.method || 'contact découvert',
      email,
      confidence: Number(contact.confidence || 0),
      status: contact.status || 'candidate',
      lastAttemptAt: contact.lastAttemptAt || '',
    })
  }
  return targets.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || a.email.localeCompare(b.email))
}

function chooseSpontaneousTarget({ targets, successfulEmails, spontaneousSends, now, env }) {
  const timezone = spontaneousTimezone(env)
  const failedToday = spontaneousSends
    .filter((row) => sameLocalDay(row.sentAt, now, timezone))
    .filter((row) => row.status === 'failed' || row.status === 'invalid')
    .map((row) => normalizeEmail(row.contactEmail || row.originalTo))
    .filter((email) => email && !successfulEmails.has(email))

  for (const email of failedToday) {
    const retry = targets.find((target) => target.email === email)
    if (retry) return retry
  }

  const attemptedEmails = new Set(spontaneousSends.map((row) => normalizeEmail(row.contactEmail || row.originalTo)).filter(Boolean))
  return targets.find((target) => !successfulEmails.has(target.email) && !attemptedEmails.has(target.email)) || null
}

function buildSpontaneousLog({
  now,
  sentAt = now.toISOString(),
  target,
  status,
  reason = '',
  error = '',
  messageId = '',
  attemptId = '',
  sentTo = '',
  subject = 'Candidature spontanée',
  attemptOfDay = 0,
  dailyStopReason = '',
}) {
  return {
    sentAt,
    actionType: SPONTANEOUS_APPLICATION,
    offerKey: target?.offerKey || 'spontaneous_application',
    offerId: '',
    offerTitle: '',
    company: target?.company || '',
    contactName: target?.contactName || '',
    originalTo: target?.email || '',
    sentTo: Array.isArray(sentTo) ? sentTo.join(', ') : String(sentTo || ''),
    subject,
    messageId,
    attemptId,
    contactEmail: target?.email || '',
    attemptOfDay,
    skipReason: status === 'skipped' ? reason : '',
    dailyStopReason,
    status,
    error: error || reason,
  }
}

function stopWithSkip({ db, summary, now, reason, dailyStopReason, logger }) {
  const row = buildSpontaneousLog({ now, status: 'skipped', reason, dailyStopReason })
  saveApplicationEmailSend(db, row)
  summary.skipped += 1
  summary.results.push(row)
  logger.warn(`[spontaneous_application] ignore: ${reason}`)
  return summary
}

function spontaneousTimezone(env) {
  return String(env.SPONTANEOUS_APPLICATION_SEND_TIMEZONE || env.APPLICATION_EMAIL_SEND_TIMEZONE || 'Europe/Paris')
}

function sameLocalDay(value, date, timeZone) {
  return localDateKey(new Date(value), timeZone) === localDateKey(date, timeZone)
}

function localDateKey(date, timeZone) {
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
