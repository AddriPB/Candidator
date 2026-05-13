import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export function openDatabase() {
  const dbPath = path.resolve(process.env.DATABASE_PATH || './data/opportunity-radar.sqlite')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function pruneOldData(db, retentionDays = Number(process.env.DATA_RETENTION_DAYS || 90)) {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 90
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const sourceChecks = db.prepare('DELETE FROM source_checks WHERE checked_at < ?').run(cutoff).changes
  const radarRuns = db.prepare('DELETE FROM radar_runs WHERE started_at < ?').run(cutoff).changes
  return { cutoff, sourceChecks, radarRuns }
}

export function saveSourceCheckLogs(db, logs) {
  const insert = db.prepare('INSERT INTO source_checks (checked_at, source, status, detail, offers_count, errors_count) VALUES (?, ?, ?, ?, ?, ?)')
  const trx = db.transaction(() => {
    for (const log of logs) {
      insert.run(log.checkedAt, log.source, log.errorsCount ? 'failed' : 'ok', log.error || '', log.offersCount || 0, log.errorsCount || 0)
    }
  })
  trx()
}

export function saveRadarRun(db, { startedAt, summary, logs, offers, reports }) {
  saveSourceCheckLogs(db, logs)
  db.prepare(`
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
