import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

export function getDatabasePath() {
  return path.resolve(projectRoot, process.env.DATABASE_PATH || './data/opportunity-radar.sqlite')
}

export function openDatabase() {
  const dbPath = getDatabasePath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      sources TEXT NOT NULL DEFAULT '[]',
      fetched_count INTEGER NOT NULL DEFAULT 0,
      kept_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS raw_offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_run_id INTEGER,
      source TEXT NOT NULL,
      source_offer_id TEXT NOT NULL,
      keyword TEXT,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      UNIQUE(source, source_offer_id),
      FOREIGN KEY(scan_run_id) REFERENCES scan_runs(id)
    );

    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_offer_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT,
      url TEXT,
      location TEXT,
      contract_type TEXT,
      salary_min INTEGER,
      salary_max INTEGER,
      salary_raw TEXT,
      remote_raw TEXT,
      description TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      verdict TEXT NOT NULL DEFAULT 'à surveiller',
      why TEXT NOT NULL DEFAULT '',
      positive_signals TEXT NOT NULL DEFAULT '[]',
      negative_signals TEXT NOT NULL DEFAULT '[]',
      missing_data TEXT NOT NULL DEFAULT '[]',
      proposed_action TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, source_offer_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(offer_id) REFERENCES offers(id)
    );

    CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('company', 'sector')),
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type, value)
    );
  `)
}

export function jsonParse(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
