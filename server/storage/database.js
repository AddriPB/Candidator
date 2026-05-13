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
  return { cutoff, sourceChecks }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checked_at TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );
  `)
}
