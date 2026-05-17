import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApplicationSmtpEnv, sendApplicationTestEmail } from './applications/emailer.js'
import { getAuthDiagnostics, loginHandler, logoutHandler, meHandler, requireAuth } from './auth/index.js'
import { checkSources } from './connectors/sourceChecks.js'
import { cvDownloadPath, getCvState, saveApplicationMailTemplate, saveCvUpload, setActiveCv } from './cv/storage.js'
import { assertSmtpConfig } from './email/smtp.js'
import { loadCandidateProfiles, profilePublicSummary, selectCandidateProfile } from './profiles/config.js'
import { getApplicationEmailEligibleOffers, getApplicationEmailSends, getLatestApplicationCandidateOffers, getLatestSourceChecks, getOfferEmailStats, openDatabase, pruneOldData, saveSourceCheckLogs } from './storage/database.js'
import { stableHash } from './radar/hash.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const db = openDatabase()
const pruned = pruneOldData(db)
const app = express()
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1)

app.use(express.json({ limit: '1mb' }))
app.use(logSourceCheckRequest)

app.use((req, res, next) => {
  const origin = req.headers.origin
  const allowed = corsOrigins()
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'Opportunity Radar', retentionDays: Number(process.env.DATA_RETENTION_DAYS || 90) })
})

app.get('/api/auth/me', meHandler)
app.post('/api/auth/login', loginHandler)
app.post('/api/auth/logout', logoutHandler)

app.post('/api/source-check', requireAuth, async (_req, res, next) => {
  try {
    const checkedAt = new Date().toISOString()
    const checks = await checkSources()
    saveSourceCheckLogs(db, checks.map((check) => ({
      checkedAt,
      source: check.source,
      offersCount: Number.parseInt(check.detail, 10) || 0,
      errorsCount: check.ok ? 0 : 1,
      error: check.ok ? '' : check.detail,
    })))
    res.json({ checkedAt, checks })
  } catch (error) {
    next(error)
  }
})

app.get('/api/source-checks/latest', requireAuth, (_req, res) => {
  res.json({ checks: getLatestSourceChecks(db) })
})

app.get('/api/offers', requireAuth, (req, res) => {
  res.json(getOffersScreenState(db, { profilePseudo: reqProfilePseudo(req) }))
})

app.get('/api/profiles', requireAuth, (_req, res) => {
  const profiles = loadCandidateProfiles()
  const cv = getCvState()
  res.json({
    mode: profiles.length ? 'multi' : 'legacy',
    active: profiles.length
      ? { pseudo: 'auto', label: `${profiles.length} profils auto` }
      : { pseudo: cv.pseudo, label: cv.pseudo },
    profiles: profiles.map(profilePublicSummary),
  })
})

app.get('/api/test/healthcheck', requireAuth, (req, res) => {
  const profiles = loadCandidateProfiles()
  const profilePseudo = reqProfilePseudo(req)
  const profile = profiles.find((item) => item.pseudo === profilePseudo)
  const cv = getCvState({ pseudo: profilePseudo })
  const cvWithFallback = profile ? withProfileCvFallback(cv, profile) : cv
  const smtp = smtpHealth(profile)
  const stats = getOfferEmailStats(db)
  const offerState = getOffersScreenState(db, { profilePseudo })
  const profileScopedOffers = profile ? offerState.offers : null
  const offersWithEmail = profileScopedOffers
    ? profileScopedOffers.filter((offer) => Array.isArray(offer.emails) && offer.emails.length > 0).length
    : stats.offersWithEmail
  const eligibleToEmail = profileScopedOffers
    ? profileScopedOffers.filter((offer) => offer.applicationStatus !== 'candidatée' && Array.isArray(offer.emails) && offer.emails.length > 0).length
    : getApplicationEmailEligibleOffers(db).offers.length
  const applicationMail = cvWithFallback.applicationMail || {}
  res.json({
    checkedAt: new Date().toISOString(),
    bot: {
      ok: true,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      database: db.kind,
      databasePath: db.path || '',
      reportFallbackDir: db.reportFallbackDir || '',
      host,
      port,
    },
    smtp,
    cv: {
      ok: Boolean(cv.activeFile),
      activeFile: cv.activeFile || '',
      storageDir: cv.storageDir,
      pseudo: cv.pseudo,
    },
    identity: {
      ok: Boolean(applicationMail.firstName && applicationMail.lastName && applicationMail.phone),
      firstName: Boolean(applicationMail.firstName),
      lastName: Boolean(applicationMail.lastName),
      phone: Boolean(applicationMail.phone),
    },
    applications: {
      dailyEnabled: process.env.APPLICATION_EMAIL_DAILY_ENABLED !== 'false',
      deliveryMode: process.env.APPLICATION_EMAIL_DELIVERY_MODE || 'live',
      redirectTo: process.env.APPLICATION_EMAIL_REDIRECT_TO || '',
      blockMonths: Number(process.env.APPLICATION_EMAIL_BLOCK_MONTHS || 12),
      offerMaxMonths: Number(process.env.APPLICATION_EMAIL_OFFER_MAX_MONTHS || 12),
      offersRecent: stats.offersRecent,
      offersWithEmail,
      eligibleToEmail,
      latestRunAt: stats.latestRunAt,
      since: stats.since,
    },
    profiles: {
      mode: profiles.length ? 'multi' : 'legacy',
      count: profiles.length || 1,
      active: profile?.pseudo || (profiles.length ? 'auto' : cv.pseudo),
    },
  })
})

app.post('/api/test/application-email', requireAuth, async (req, res, next) => {
  try {
    res.json(await sendApplicationTestEmail({ to: req.body?.to, profilePseudo: reqProfilePseudo(req) }))
  } catch (error) {
    next(error)
  }
})

app.get('/api/cv', requireAuth, (req, res) => {
  const profilePseudo = reqProfilePseudo(req)
  const profiles = loadCandidateProfiles()
  const profile = profiles.find((item) => item.pseudo === profilePseudo)
  const cv = getCvState({ pseudo: profilePseudo })
  res.json(profile ? withProfileCvFallback(cv, profile) : cv)
})

app.post('/api/cv/upload', requireAuth, express.raw({
  limit: '10mb',
  type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
}), (req, res, next) => {
  try {
    res.json(saveCvUpload({
      originalName: decodeHeaderValue(req.headers['x-file-name']),
      buffer: req.body,
      pseudo: reqProfilePseudo(req),
    }))
  } catch (error) {
    next(error)
  }
})

app.post('/api/cv/active', requireAuth, (req, res, next) => {
  try {
    res.json(setActiveCv(req.body?.fileName, { pseudo: reqProfilePseudo(req) }))
  } catch (error) {
    next(error)
  }
})

app.post('/api/cv/application-mail', requireAuth, (req, res, next) => {
  try {
    res.json(saveApplicationMailTemplate(req.body, { pseudo: reqProfilePseudo(req) }))
  } catch (error) {
    next(error)
  }
})

app.get('/api/cv/download/:fileName', requireAuth, (req, res, next) => {
  try {
    const file = cvDownloadPath(req.params.fileName, { pseudo: reqProfilePseudo(req) })
    res.download(file.filePath, file.fileName)
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/prune', requireAuth, (_req, res) => {
  res.json({ pruned: pruneOldData(db) })
})

const dist = path.join(projectRoot, 'dist')
app.use('/Opportunity-Radar', express.static(dist))
app.use(express.static(dist))
app.get(/^\/Opportunity-Radar\/.*$/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(error.status || 500).json({ error: error.status ? error.message : 'internal_error' })
})

function corsOrigins() {
  return String(process.env.CORS_ORIGINS || 'https://addripb.github.io').split(',').map((item) => item.trim()).filter(Boolean)
}

function reqProfilePseudo(req) {
  return String(req.query?.profilePseudo || req.body?.profilePseudo || '').trim()
}

function decodeHeaderValue(value) {
  const raw = String(value || '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function smtpHealth(profile = null) {
  const env = profile ? buildApplicationSmtpEnv(profile, process.env) : process.env
  try {
    assertSmtpConfig(env)
    return {
      ok: true,
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT),
      secure: env.SMTP_SECURE === 'true',
      user: maskEmail(env.SMTP_USER),
      from: maskEmail(env.APPLICATION_FROM),
    }
  } catch (error) {
    return {
      ok: false,
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT || 0),
      secure: env.SMTP_SECURE === 'true',
      user: maskEmail(env.SMTP_USER),
      from: maskEmail(env.APPLICATION_FROM),
      error: error.message,
    }
  }
}

function maskEmail(value) {
  const text = String(value || '').trim()
  const [local, domain] = text.split('@')
  if (!local || !domain) return text ? 'renseigné' : ''
  return `${local.slice(0, 2)}***@${domain}`
}

function logSourceCheckRequest(req, res, next) {
  if (req.path !== '/api/source-check') return next()

  const startedAt = Date.now()
  const auth = getAuthDiagnostics(req)
  res.on('finish', () => {
    console.info('[source-check]', JSON.stringify({
      method: req.method,
      origin: req.headers.origin || '',
      userAgent: req.headers['user-agent'] || '',
      cookiePresent: auth.cookiePresent,
      sessionCookiePresent: auth.sessionCookiePresent,
      sessionValid: auth.sessionValid,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    }))
  })
  next()
}

function getOffersScreenState(db, { profilePseudo = '' } = {}) {
  const source = getLatestApplicationCandidateOffers(db)
  const profiles = loadCandidateProfiles()
  const normalizedProfilePseudo = String(profilePseudo || '').trim()
  const selectedProfile = normalizedProfilePseudo
    ? profiles.find((profile) => profile.pseudo === normalizedProfilePseudo)
    : null
  const sendsByOfferKey = applicationSendsByOfferKey(getApplicationEmailSends(db), { profilePseudo: selectedProfile?.pseudo || '' })
  const screenOffers = selectedProfile
    ? source.offers.filter((offer) => selectCandidateProfile(offer, profiles)?.pseudo === selectedProfile.pseudo)
    : source.offers
  const offers = screenOffers.map((offer) => {
    const offerKey = applicationOfferKey(offer)
    const latestSend = sendsByOfferKey.get(offerKey)
    return {
      ...offer,
      offerKey,
      applicationStatus: latestSend ? 'candidatée' : 'à candidater',
      applicationLastSentAt: latestSend?.sentAt || '',
      applicationEmailStatus: latestSend?.status || '',
    }
  })

  return {
    startedAt: source.startedAt || null,
    since: source.since || null,
    offers,
  }
}

function applicationSendsByOfferKey(sends, { profilePseudo = '' } = {}) {
  const acceptedStatuses = new Set(['sent', 'sent_pending_delivery', 'delivered_or_no_bounce_after_grace_period'])
  const rows = sends
    .filter((row) => !profilePseudo || row.profilePseudo === profilePseudo)
    .filter((row) => row.actionType !== 'spontaneous_application')
    .filter((row) => acceptedStatuses.has(row.status))
    .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))
  const result = new Map()
  for (const row of rows) {
    if (row.offerKey && !result.has(row.offerKey)) result.set(row.offerKey, row)
  }
  return result
}

function withProfileCvFallback(cv, profile) {
  if (cv.applicationMail?.configured) return cv
  return {
    ...cv,
    applicationMail: {
      ...cv.applicationMail,
      firstName: profile.firstName || cv.applicationMail?.firstName || '',
      lastName: profile.lastName || cv.applicationMail?.lastName || '',
      phone: profile.phone || cv.applicationMail?.phone || '',
      subjectTemplate: profile.template?.subject || cv.applicationMail?.subjectTemplate,
      bodyTemplate: profile.template?.body || cv.applicationMail?.bodyTemplate,
      configured: false,
    },
  }
}

function applicationOfferKey(offer) {
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

function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return String(url || '').trim().toLowerCase()
  }
}

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 4173)
app.listen(port, host, () => {
  console.log(`Opportunity Radar API listening on http://${host}:${port}`)
  console.log(`Retention cleanup removed ${pruned.sourceChecks} source check row(s) before ${pruned.cutoff}`)
})
