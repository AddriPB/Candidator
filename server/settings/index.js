import { jsonParse } from '../storage/database.js'

export const DEFAULT_SETTINGS = {
  niveau_cible: 'confirmé',
  annees_experience: 5,
  contrat: 'CDI',
  salaire_min: 50000,
  teletravail_min_jours: 2,
  zones: ['Paris/IDF', 'hybride IDF', 'full remote France'],
  sources_actives: ['france_travail', 'adzuna', 'jsearch', 'careerjet'],
  blacklist_entreprises: [],
  blacklist_secteurs: [],
  keywords: [
    'Product Owner',
    'Product Manager',
    'Business Analyst',
    'Proxy PO',
    'Chef de projet digital',
    'Consultant AMOA',
    'Consultant MOA',
  ],
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value_json FROM settings').all()
  const stored = Object.fromEntries(rows.map((row) => [row.key, jsonParse(row.value_json, null)]))
  return { ...DEFAULT_SETTINGS, ...stored }
}

export function updateSettings(db, patch) {
  const current = getSettings(db)
  const next = { ...current, ...sanitizeSettings(patch) }
  const stmt = db.prepare(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
  `)
  const trx = db.transaction(() => {
    for (const [key, value] of Object.entries(next)) {
      stmt.run({ key, value: JSON.stringify(value) })
    }
    syncBlacklist(db, 'company', next.blacklist_entreprises)
    syncBlacklist(db, 'sector', next.blacklist_secteurs)
  })
  trx()
  return getSettings(db)
}

export function ensureDefaultSettings(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM settings').get().count
  if (count === 0) updateSettings(db, DEFAULT_SETTINGS)
}

function sanitizeSettings(patch = {}) {
  const clean = {}
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (patch[key] === undefined) continue
    if (Array.isArray(DEFAULT_SETTINGS[key])) {
      clean[key] = Array.isArray(patch[key]) ? patch[key].map(String).map((s) => s.trim()).filter(Boolean) : []
    } else if (typeof DEFAULT_SETTINGS[key] === 'number') {
      clean[key] = Number(patch[key]) || DEFAULT_SETTINGS[key]
    } else {
      clean[key] = String(patch[key] ?? '').trim() || DEFAULT_SETTINGS[key]
    }
  }
  return clean
}

function syncBlacklist(db, type, values) {
  db.prepare('DELETE FROM blacklist WHERE type = ?').run(type)
  const insert = db.prepare('INSERT OR IGNORE INTO blacklist (type, value) VALUES (?, ?)')
  for (const value of values || []) insert.run(type, value)
}
