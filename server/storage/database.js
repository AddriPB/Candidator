import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function openDatabase() {
  const dbPath = path.resolve(process.env.DATABASE_PATH || './data/opportunity-radar.sqlite')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  try {
    const Database = requireBetterSqlite()
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    migrate(db)
    importJsonStoreIfSqliteEmpty(db, dbPath)
    return { kind: 'sqlite', db }
  } catch (error) {
    const jsonPath = dbPath.replace(/\.(sqlite|db)$/i, '.json')
    console.warn(`[storage] better-sqlite3 unavailable, using JSON store at ${jsonPath}: ${error.message}`)
    return { kind: 'json', path: jsonPath, data: readJsonStore(jsonPath) }
  }
}

export function pruneOldData(db, retentionDays = Number(process.env.DATA_RETENTION_DAYS || 90)) {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 90
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  if (db.kind === 'json') {
    refreshJsonStore(db)
    const beforeSourceChecks = db.data.sourceChecks.length
    const beforeRadarRuns = db.data.radarRuns.length
    const beforeOfferEmails = db.data.offerEmails.length
    const beforeApplicationEmailSends = db.data.applicationEmailSends.length
    const beforeApplicationContacts = db.data.applicationContacts.length
    const applicationEmailCutoff = new Date(Date.now() - Math.max(days, applicationEmailBlockDays()) * 24 * 60 * 60 * 1000).toISOString()
    db.data.sourceChecks = db.data.sourceChecks.filter((row) => row.checkedAt >= cutoff)
    db.data.radarRuns = db.data.radarRuns.filter((row) => row.startedAt >= cutoff)
    db.data.offerEmails = db.data.offerEmails.filter((row) => row.runStartedAt >= cutoff)
    db.data.applicationEmailSends = db.data.applicationEmailSends.filter((row) => row.sentAt >= applicationEmailCutoff)
    db.data.applicationContacts = db.data.applicationContacts.filter((row) => !row.updatedAt || row.updatedAt >= applicationEmailCutoff)
    writeJsonStore(db)
    return {
      cutoff,
      sourceChecks: beforeSourceChecks - db.data.sourceChecks.length,
      radarRuns: beforeRadarRuns - db.data.radarRuns.length,
      offerEmails: beforeOfferEmails - db.data.offerEmails.length,
      applicationEmailSends: beforeApplicationEmailSends - db.data.applicationEmailSends.length,
      applicationContacts: beforeApplicationContacts - db.data.applicationContacts.length,
    }
  }
  const applicationEmailCutoff = new Date(Date.now() - Math.max(days, applicationEmailBlockDays()) * 24 * 60 * 60 * 1000).toISOString()
  const sourceChecks = db.db.prepare('DELETE FROM source_checks WHERE checked_at < ?').run(cutoff).changes
  const radarRuns = db.db.prepare('DELETE FROM radar_runs WHERE started_at < ?').run(cutoff).changes
  const offerEmails = db.db.prepare('DELETE FROM offer_emails WHERE run_started_at < ?').run(cutoff).changes
  const applicationEmailSends = db.db.prepare('DELETE FROM application_email_sends WHERE sent_at < ?').run(applicationEmailCutoff).changes
  const applicationContacts = db.db.prepare('DELETE FROM application_contacts WHERE updated_at < ?').run(applicationEmailCutoff).changes
  return { cutoff, sourceChecks, radarRuns, offerEmails, applicationEmailSends, applicationContacts }
}

export function saveSourceCheckLogs(db, logs) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    for (const log of logs) {
      db.data.sourceChecks.push({
        checkedAt: log.checkedAt,
        source: log.source,
        status: log.errorsCount ? 'failed' : 'ok',
        detail: log.error || '',
        offersCount: log.offersCount || 0,
        errorsCount: log.errorsCount || 0,
      })
    }
    writeJsonStore(db)
    return
  }
  const insert = db.db.prepare('INSERT INTO source_checks (checked_at, source, status, detail, offers_count, errors_count) VALUES (?, ?, ?, ?, ?, ?)')
  const trx = db.db.transaction(() => {
    for (const log of logs) {
      insert.run(log.checkedAt, log.source, log.errorsCount ? 'failed' : 'ok', log.error || '', log.offersCount || 0, log.errorsCount || 0)
    }
  })
  trx()
}

export function saveRadarRun(db, { startedAt, summary, logs, offers, reports }) {
  saveSourceCheckLogs(db, logs)
  const offerEmails = collectOfferEmails({ startedAt, offers })
  const storedOffers = offers.filter(isVisibleOffer)
  if (db.kind === 'json') {
    refreshJsonStore(db)
    db.data.radarRuns.push({ startedAt, summary, logs, offers: storedOffers, reports })
    db.data.offerEmails.push(...offerEmails)
    writeJsonStore(db)
    return
  }
  const insertRun = db.db.prepare(`
      INSERT INTO radar_runs (started_at, summary_json, logs_json, offers_json, markdown_path, json_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
  const deleteEmails = db.db.prepare('DELETE FROM offer_emails WHERE run_started_at = ?')
  const insertEmail = db.db.prepare(`
      INSERT INTO offer_emails (run_started_at, offer_id, source, verdict, email)
      VALUES (?, ?, ?, ?, ?)
    `)
  const trx = db.db.transaction(() => {
    insertRun.run(
      startedAt,
      JSON.stringify(summary),
      JSON.stringify(logs),
      JSON.stringify(storedOffers),
      reports.markdownPath,
      reports.jsonPath,
    )
    deleteEmails.run(startedAt)
    for (const row of offerEmails) insertEmail.run(row.runStartedAt, row.offerId, row.source, row.verdict, row.email)
  })
  trx()
}

export function getLatestRadarOffers(db) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    const row = [...db.data.radarRuns].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0]
    return { startedAt: row?.startedAt || null, offers: (row?.offers || []).filter(isVisibleOffer).map(toPublicOffer) }
  }
  const row = db.db.prepare(`
    SELECT started_at AS startedAt, offers_json AS offersJson
    FROM radar_runs
    ORDER BY started_at DESC
    LIMIT 1
  `).get()

  if (!row) return { startedAt: null, offers: [] }

  let offers = []
  try {
    offers = JSON.parse(row.offersJson)
  } catch {
    offers = []
  }

  return {
    startedAt: row.startedAt,
    offers: offers.filter(isVisibleOffer).map(toPublicOffer),
  }
}

export function getLatestApplicationCandidateOffers(db) {
  return getApplicationCandidateOffers(db)
}

export function getApplicationEmailEligibleOffers(db, { since = applicationWindowStart(), now = new Date() } = {}) {
  return getApplicationCandidateOffers(db, { since, now, requireEmail: true })
}

export function getApplicationCandidateOffers(db, { since = applicationWindowStart(), now = new Date(), requireEmail = false } = {}) {
  const rows = readRadarRuns(db)
  const offers = []
  const seen = new Set()
  for (const row of rows) {
    for (const offer of row.offers || []) {
      if (!isApplicationCandidateOffer(offer, { since, now, requireEmail })) continue
      const key = offerStorageKey(offer)
      if (seen.has(key)) continue
      seen.add(key)
      offers.push({ ...offer, runStartedAt: row.startedAt })
    }
  }
  return {
    since: since.toISOString(),
    startedAt: rows[0]?.startedAt || null,
    offers,
  }
}

export function getOfferEmailStats(db, { since = applicationWindowStart(), now = new Date() } = {}) {
  const rows = readRadarRuns(db)
  const allKeys = new Set()
  const emailKeys = new Set()
  let latestRunAt = null

  for (const row of rows) {
    if (!latestRunAt || row.startedAt > latestRunAt) latestRunAt = row.startedAt
    for (const offer of row.offers || []) {
      if (!isVisibleOffer(offer) || !isRecentOffer(offer, { since, now })) continue
      const key = offerStorageKey(offer)
      allKeys.add(key)
      if (Array.isArray(offer.emails) && offer.emails.length > 0) emailKeys.add(key)
    }
  }

  return {
    since: since.toISOString(),
    latestRunAt,
    offersRecent: allKeys.size,
    offersWithEmail: emailKeys.size,
  }
}

export function getRecentApplicationEmailSends(db, cutoff) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    return db.data.applicationEmailSends.filter((row) => row.sentAt >= cutoff).map(normalizeApplicationEmailSend)
  }
  return db.db.prepare(`
    SELECT sent_at AS sentAt,
           action_type AS actionType,
           offer_key AS offerKey,
           offer_id AS offerId,
           offer_title AS offerTitle,
           company,
           contact_name AS contactName,
           original_to AS originalTo,
           sent_to AS sentTo,
           subject,
           message_id AS messageId,
           attempt_id AS attemptId,
           contact_email AS contactEmail,
           attempt_of_day AS attemptOfDay,
           skip_reason AS skipReason,
           daily_stop_reason AS dailyStopReason,
           status,
           error
    FROM application_email_sends
    WHERE sent_at >= ?
  `).all(cutoff)
}

export function getApplicationEmailSends(db, { since = new Date(0).toISOString(), statuses = [] } = {}) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    return db.data.applicationEmailSends
      .filter((row) => row.sentAt >= since)
      .filter((row) => statuses.length === 0 || statuses.includes(row.status))
      .map(normalizeApplicationEmailSend)
  }
  const rows = db.db.prepare(`
    SELECT sent_at AS sentAt,
           action_type AS actionType,
           offer_key AS offerKey,
           offer_id AS offerId,
           offer_title AS offerTitle,
           company,
           contact_name AS contactName,
           original_to AS originalTo,
           sent_to AS sentTo,
           subject,
           message_id AS messageId,
           attempt_id AS attemptId,
           contact_email AS contactEmail,
           attempt_of_day AS attemptOfDay,
           skip_reason AS skipReason,
           daily_stop_reason AS dailyStopReason,
           status,
           error
    FROM application_email_sends
    WHERE sent_at >= ?
    ORDER BY sent_at DESC
  `).all(since)
  return statuses.length ? rows.filter((row) => statuses.includes(row.status)) : rows
}

export function saveApplicationEmailSend(db, row) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    db.data.applicationEmailSends.push(row)
    writeJsonStore(db)
    return
  }
  db.db.prepare(`
    INSERT INTO application_email_sends (
      sent_at, action_type, offer_key, offer_id, offer_title, company, contact_name, original_to, sent_to, subject, message_id, attempt_id, contact_email, attempt_of_day, skip_reason, daily_stop_reason, status, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.sentAt,
    row.actionType || 'job_offer_application',
    row.offerKey,
    row.offerId,
    row.offerTitle,
    row.company,
    row.contactName || '',
    row.originalTo,
    row.sentTo,
    row.subject,
    row.messageId || '',
    row.attemptId || '',
    row.contactEmail || '',
    Number(row.attemptOfDay || 0),
    row.skipReason || '',
    row.dailyStopReason || '',
    row.status,
    row.error || '',
  )
}

export function getAllApplicationContacts(db) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    return db.data.applicationContacts
      .map((row) => ({ ...row, email: normalizeEmail(row.email) }))
      .filter((row) => row.email)
      .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || String(a.email).localeCompare(String(b.email)))
  }
  return db.db.prepare(`
    SELECT offer_key AS offerKey,
           email,
           method,
           source_url AS sourceUrl,
           confidence,
           status,
           last_attempt_at AS lastAttemptAt,
           bounce_reason AS bounceReason,
           attempts,
           updated_at AS updatedAt
    FROM application_contacts
    ORDER BY confidence DESC, email ASC
  `).all()
}

export function getApplicationContacts(db, offerKey) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    return db.data.applicationContacts
      .filter((row) => row.offerKey === offerKey)
      .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || String(a.email).localeCompare(String(b.email)))
  }
  return db.db.prepare(`
    SELECT offer_key AS offerKey,
           email,
           method,
           source_url AS sourceUrl,
           confidence,
           status,
           last_attempt_at AS lastAttemptAt,
           bounce_reason AS bounceReason,
           attempts,
           updated_at AS updatedAt
    FROM application_contacts
    WHERE offer_key = ?
    ORDER BY confidence DESC, email ASC
  `).all(offerKey)
}

export function upsertApplicationContacts(db, contacts, { now = new Date() } = {}) {
  if (!contacts.length) return
  const updatedAt = now.toISOString()
  if (db.kind === 'json') {
    refreshJsonStore(db)
    for (const contact of contacts) {
      const index = db.data.applicationContacts.findIndex((row) => row.offerKey === contact.offerKey && row.email === contact.email)
      const existing = index >= 0 ? db.data.applicationContacts[index] : {}
      const next = {
        ...existing,
        offerKey: contact.offerKey,
        email: contact.email,
        method: contact.method || existing.method || 'unknown',
        sourceUrl: contact.sourceUrl || existing.sourceUrl || '',
        confidence: Number(contact.confidence || existing.confidence || 0),
        status: existing.status && existing.status !== 'candidate' ? existing.status : contact.status || 'candidate',
        lastAttemptAt: existing.lastAttemptAt || '',
        bounceReason: existing.bounceReason || '',
        attempts: Number(existing.attempts || 0),
        updatedAt,
      }
      if (index >= 0) db.data.applicationContacts[index] = next
      else db.data.applicationContacts.push(next)
    }
    writeJsonStore(db)
    return
  }
  const statement = db.db.prepare(`
    INSERT INTO application_contacts (
      offer_key, email, method, source_url, confidence, status, last_attempt_at, bounce_reason, attempts, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', '', 0, ?)
    ON CONFLICT(offer_key, email) DO UPDATE SET
      method = excluded.method,
      source_url = CASE WHEN excluded.source_url != '' THEN excluded.source_url ELSE application_contacts.source_url END,
      confidence = MAX(application_contacts.confidence, excluded.confidence),
      status = CASE WHEN application_contacts.status = 'candidate' THEN excluded.status ELSE application_contacts.status END,
      updated_at = excluded.updated_at
  `)
  const trx = db.db.transaction(() => {
    for (const contact of contacts) {
      statement.run(
        contact.offerKey,
        contact.email,
        contact.method || 'unknown',
        contact.sourceUrl || '',
        Number(contact.confidence || 0),
        contact.status || 'candidate',
        updatedAt,
      )
    }
  })
  trx()
}

export function updateApplicationContactStatus(db, { offerKey, email, status, lastAttemptAt = '', bounceReason = '', incrementAttempts = false }) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    const row = db.data.applicationContacts.find((item) => item.offerKey === offerKey && item.email === email)
    if (row) {
      row.status = status || row.status
      if (lastAttemptAt) row.lastAttemptAt = lastAttemptAt
      if (bounceReason) row.bounceReason = bounceReason
      if (incrementAttempts) row.attempts = Number(row.attempts || 0) + 1
      row.updatedAt = new Date().toISOString()
      writeJsonStore(db)
    }
    return
  }
  db.db.prepare(`
    UPDATE application_contacts
    SET status = COALESCE(NULLIF(?, ''), status),
        last_attempt_at = CASE WHEN ? != '' THEN ? ELSE last_attempt_at END,
        bounce_reason = CASE WHEN ? != '' THEN ? ELSE bounce_reason END,
        attempts = attempts + ?,
        updated_at = ?
    WHERE offer_key = ? AND email = ?
  `).run(
    status || '',
    lastAttemptAt || '',
    lastAttemptAt || '',
    bounceReason || '',
    bounceReason || '',
    incrementAttempts ? 1 : 0,
    new Date().toISOString(),
    offerKey,
    email,
  )
}

export function updateApplicationSendStatus(db, { attemptId, status, error = '' }) {
  if (!attemptId) return
  if (db.kind === 'json') {
    refreshJsonStore(db)
    for (const row of db.data.applicationEmailSends) {
      if (row.attemptId !== attemptId) continue
      row.status = status || row.status
      if (error) row.error = error
    }
    writeJsonStore(db)
    return
  }
  db.db.prepare(`
    UPDATE application_email_sends
    SET status = COALESCE(NULLIF(?, ''), status),
        error = CASE WHEN ? != '' THEN ? ELSE error END
    WHERE attempt_id = ?
  `).run(status || '', error || '', error || '', attemptId)
}

export function getLatestSourceChecks(db) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    const latest = db.data.sourceChecks.reduce((max, row) => row.checkedAt > max ? row.checkedAt : max, '')
    return db.data.sourceChecks
      .filter((row) => row.checkedAt === latest)
      .sort((a, b) => a.source.localeCompare(b.source))
      .map((row) => ({
        source: row.source,
        status: row.status,
        detail: row.detail,
        checkedAt: row.checkedAt,
      }))
  }
  return db.db.prepare(`
    SELECT source, status, detail, checked_at AS checkedAt
    FROM source_checks
    WHERE checked_at = (SELECT MAX(checked_at) FROM source_checks)
    ORDER BY source
  `).all()
}

function toPublicOffer(offer) {
  return {
    id: offer.id,
    source: offer.source,
    sources: Array.isArray(offer.sources) ? offer.sources : [offer.source].filter(Boolean),
    title: offer.title,
    company: offer.company,
    location: offer.location,
    remote: offer.remote,
    contract: offer.contract,
    salaryMin: offer.salaryMin,
    salaryMax: offer.salaryMax,
    currency: offer.currency,
    publishedAt: offer.publishedAt,
    link: offer.link,
    emails: Array.isArray(offer.emails) ? offer.emails : [],
    hasEmail: Boolean(offer.hasEmail || offer.emails?.length),
    level: offer.level,
    collectedAt: offer.collectedAt,
    query: offer.query,
    score: offer.score,
    verdict: offer.verdict,
    evaluation: offer.evaluation ? {
      status: offer.evaluation.status,
      role: offer.evaluation.role,
      contract: offer.evaluation.contract,
      zone: offer.evaluation.zone,
      remote: offer.evaluation.remote,
      salary: offer.evaluation.salary,
      reasons: offer.evaluation.reasons,
      warnings: offer.evaluation.warnings,
      rejectReasons: offer.evaluation.rejectReasons,
    } : null,
  }
}

function isVisibleOffer(offer) {
  return offer.verdict !== 'à rejeter' && offer.evaluation?.status !== 'à rejeter'
}

function isApplicationCandidateOffer(offer, { since, now, requireEmail = false }) {
  if (!isVisibleOffer(offer) || !isRecentOffer(offer, { since, now })) return false
  return !requireEmail || (Array.isArray(offer.emails) && offer.emails.length > 0)
}

function isRecentOffer(offer, { since, now }) {
  const value = offer.publishedAt || offer.collectedAt || ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return date >= since && date <= now
}

function readRadarRuns(db) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    return [...db.data.radarRuns]
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .map((row) => ({ startedAt: row.startedAt, offers: row.offers || [] }))
  }

  return db.db.prepare(`
    SELECT started_at AS startedAt, offers_json AS offersJson
    FROM radar_runs
    ORDER BY started_at DESC
  `).all().map((row) => {
    let offers = []
    try {
      offers = JSON.parse(row.offersJson)
    } catch {
      offers = []
    }
    return { startedAt: row.startedAt, offers }
  })
}

function offerStorageKey(offer) {
  if (offer.link) return `link:${normalizeUrl(offer.link)}`
  if (offer.id) return `id:${offer.id}`
  return [
    offer.title,
    offer.company,
    offer.location,
    offer.source,
    String(offer.description || '').slice(0, 180),
  ].join('|').toLowerCase()
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checked_at TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      offers_count INTEGER NOT NULL DEFAULT 0,
      errors_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS radar_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      logs_json TEXT NOT NULL,
      offers_json TEXT NOT NULL,
      markdown_path TEXT NOT NULL,
      json_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offer_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_started_at TEXT NOT NULL,
      offer_id TEXT NOT NULL,
      source TEXT NOT NULL,
      verdict TEXT NOT NULL,
      email TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_offer_emails_run_started_at ON offer_emails(run_started_at);

    CREATE TABLE IF NOT EXISTS application_email_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at TEXT NOT NULL,
      action_type TEXT NOT NULL DEFAULT 'job_offer_application',
      offer_key TEXT NOT NULL,
      offer_id TEXT NOT NULL,
      offer_title TEXT NOT NULL,
      company TEXT NOT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      original_to TEXT NOT NULL,
      sent_to TEXT NOT NULL,
      subject TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      attempt_id TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      attempt_of_day INTEGER NOT NULL DEFAULT 0,
      skip_reason TEXT NOT NULL DEFAULT '',
      daily_stop_reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_application_email_sends_offer_key_sent_at
      ON application_email_sends(offer_key, sent_at);

    CREATE TABLE IF NOT EXISTS application_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_key TEXT NOT NULL,
      email TEXT NOT NULL,
      method TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '',
      confidence INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'candidate',
      last_attempt_at TEXT NOT NULL DEFAULT '',
      bounce_reason TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_application_contacts_offer_email
      ON application_contacts(offer_key, email);
  `)

  ensureColumn(db, 'source_checks', 'offers_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'source_checks', 'errors_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'application_email_sends', 'attempt_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'application_email_sends', 'contact_email', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'application_email_sends', 'action_type', "TEXT NOT NULL DEFAULT 'job_offer_application'")
  ensureColumn(db, 'application_email_sends', 'contact_name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'application_email_sends', 'attempt_of_day', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'application_email_sends', 'skip_reason', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'application_email_sends', 'daily_stop_reason', "TEXT NOT NULL DEFAULT ''")
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name)
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function importJsonStoreIfSqliteEmpty(db, dbPath) {
  const jsonPath = dbPath.replace(/\.(sqlite|db)$/i, '.json')
  if (!fs.existsSync(jsonPath)) return
  if (!sqliteStoreIsEmpty(db)) return

  const data = readJsonStore(jsonPath)
  const insertSourceCheck = db.prepare(`
    INSERT INTO source_checks (checked_at, source, status, detail, offers_count, errors_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertRadarRun = db.prepare(`
    INSERT INTO radar_runs (started_at, summary_json, logs_json, offers_json, markdown_path, json_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertOfferEmail = db.prepare(`
    INSERT INTO offer_emails (run_started_at, offer_id, source, verdict, email)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertSend = db.prepare(`
    INSERT INTO application_email_sends (
      sent_at, action_type, offer_key, offer_id, offer_title, company, contact_name, original_to, sent_to, subject, message_id, attempt_id, contact_email, attempt_of_day, skip_reason, daily_stop_reason, status, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO application_contacts (
      offer_key, email, method, source_url, confidence, status, last_attempt_at, bounce_reason, attempts, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const trx = db.transaction(() => {
    for (const row of data.sourceChecks) {
      insertSourceCheck.run(
        row.checkedAt || '',
        row.source || '',
        row.status || '',
        row.detail || '',
        Number(row.offersCount || 0),
        Number(row.errorsCount || 0),
      )
    }
    for (const row of data.radarRuns) {
      insertRadarRun.run(
        row.startedAt || '',
        JSON.stringify(row.summary || {}),
        JSON.stringify(row.logs || []),
        JSON.stringify(row.offers || []),
        row.reports?.markdownPath || '',
        row.reports?.jsonPath || '',
      )
    }
    for (const row of data.offerEmails) {
      insertOfferEmail.run(row.runStartedAt || '', row.offerId || '', row.source || '', row.verdict || '', normalizeEmail(row.email))
    }
    for (const row of data.applicationEmailSends) {
      const normalized = normalizeApplicationEmailSend(row)
      insertSend.run(
        normalized.sentAt || '',
        normalized.actionType || 'job_offer_application',
        normalized.offerKey || '',
        normalized.offerId || '',
        normalized.offerTitle || '',
        normalized.company || '',
        normalized.contactName || '',
        normalized.originalTo || '',
        normalized.sentTo || '',
        normalized.subject || '',
        normalized.messageId || '',
        normalized.attemptId || '',
        normalized.contactEmail || '',
        Number(normalized.attemptOfDay || 0),
        normalized.skipReason || '',
        normalized.dailyStopReason || '',
        normalized.status || '',
        normalized.error || '',
      )
    }
    for (const row of data.applicationContacts) {
      const email = normalizeEmail(row.email)
      if (!email || !row.offerKey) continue
      insertContact.run(
        row.offerKey,
        email,
        row.method || 'unknown',
        row.sourceUrl || row.source_url || '',
        Number(row.confidence || 0),
        row.status || 'candidate',
        row.lastAttemptAt || row.last_attempt_at || '',
        row.bounceReason || row.bounce_reason || '',
        Number(row.attempts || 0),
        row.updatedAt || row.updated_at || '',
      )
    }
  })
  trx()
  console.log(`[storage] imported JSON store into SQLite from ${jsonPath}`)
}

function sqliteStoreIsEmpty(db) {
  const tables = ['source_checks', 'radar_runs', 'offer_emails', 'application_email_sends', 'application_contacts']
  return tables.every((table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0) === 0)
}

function requireBetterSqlite() {
  return require('better-sqlite3')
}

function readJsonStore(jsonPath) {
  try {
    return normalizeJsonStore(JSON.parse(fs.readFileSync(jsonPath, 'utf8')))
  } catch {
    return normalizeJsonStore({})
  }
}

function refreshJsonStore(store) {
  store.data = readJsonStore(store.path)
}

function normalizeJsonStore(data) {
  return {
    sourceChecks: Array.isArray(data?.sourceChecks) ? data.sourceChecks : [],
    radarRuns: Array.isArray(data?.radarRuns) ? data.radarRuns : [],
    offerEmails: Array.isArray(data?.offerEmails) ? data.offerEmails : [],
    applicationEmailSends: Array.isArray(data?.applicationEmailSends) ? data.applicationEmailSends : [],
    applicationContacts: Array.isArray(data?.applicationContacts) ? data.applicationContacts : [],
  }
}

function writeJsonStore(store) {
  fs.mkdirSync(path.dirname(store.path), { recursive: true })
  fs.writeFileSync(store.path, `${JSON.stringify(store.data, null, 2)}\n`)
}

function normalizeApplicationEmailSend(row) {
  return {
    ...row,
    actionType: row.actionType || row.action_type || 'job_offer_application',
    contactName: row.contactName || row.contact_name || '',
    attemptOfDay: Number(row.attemptOfDay || row.attempt_of_day || 0),
    skipReason: row.skipReason || row.skip_reason || '',
    dailyStopReason: row.dailyStopReason || row.daily_stop_reason || '',
  }
}

function collectOfferEmails({ startedAt, offers }) {
  return offers.flatMap((offer) => {
    const emails = Array.isArray(offer.emails) ? offer.emails : []
    return emails.map((email) => ({
      runStartedAt: startedAt,
      offerId: offer.id,
      source: offer.source,
      verdict: offer.verdict || '',
      email,
    }))
  })
}

function applicationEmailBlockDays() {
  const months = Number(process.env.APPLICATION_EMAIL_BLOCK_MONTHS || 12)
  return (Number.isFinite(months) && months > 0 ? months : 12) * 31
}

function applicationWindowStart(now = new Date()) {
  const months = Number(process.env.APPLICATION_EMAIL_OFFER_MAX_MONTHS || 12)
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}
