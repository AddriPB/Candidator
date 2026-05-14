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
    db.data.sourceChecks = db.data.sourceChecks.filter((row) => row.checkedAt >= cutoff)
    db.data.radarRuns = db.data.radarRuns.filter((row) => row.startedAt >= cutoff)
    writeJsonStore(db)
    return {
      cutoff,
      sourceChecks: beforeSourceChecks - db.data.sourceChecks.length,
      radarRuns: beforeRadarRuns - db.data.radarRuns.length,
    }
  }
  const sourceChecks = db.db.prepare('DELETE FROM source_checks WHERE checked_at < ?').run(cutoff).changes
  const radarRuns = db.db.prepare('DELETE FROM radar_runs WHERE started_at < ?').run(cutoff).changes
  return { cutoff, sourceChecks, radarRuns }
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
  if (db.kind === 'json') {
    db.data.radarRuns.push({ startedAt, summary, logs, offers, reports })
    writeJsonStore(db)
    return
  }
  db.db.prepare(`
    INSERT INTO radar_runs (started_at, summary_json, logs_json, offers_json, markdown_path, json_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    startedAt,
    JSON.stringify(summary),
    JSON.stringify(logs),
    JSON.stringify(offers),
    reports.markdownPath,
    reports.jsonPath,
  )
}

export function getLatestRadarOffers(db) {
  if (db.kind === 'json') {
    refreshJsonStore(db)
    const row = [...db.data.radarRuns].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0]
    return { startedAt: row?.startedAt || null, offers: (row?.offers || []).map(toPublicOffer) }
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
    offers: offers.map(toPublicOffer),
  }
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
  `)

  ensureColumn(db, 'source_checks', 'offers_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'source_checks', 'errors_count', 'INTEGER NOT NULL DEFAULT 0')
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name)
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function requireBetterSqlite() {
  return require('better-sqlite3')
}

function readJsonStore(jsonPath) {
  try {
    return normalizeJsonStore(JSON.parse(fs.readFileSync(jsonPath, 'utf8')))
  } catch {
    return { sourceChecks: [], radarRuns: [] }
  }
}

function refreshJsonStore(store) {
  store.data = readJsonStore(store.path)
}

function normalizeJsonStore(data) {
  return {
    sourceChecks: Array.isArray(data?.sourceChecks) ? data.sourceChecks : [],
    radarRuns: Array.isArray(data?.radarRuns) ? data.radarRuns : [],
  }
}

function writeJsonStore(store) {
  fs.mkdirSync(path.dirname(store.path), { recursive: true })
  fs.writeFileSync(store.path, `${JSON.stringify(store.data, null, 2)}\n`)
}
