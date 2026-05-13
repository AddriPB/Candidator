import { connectors } from '../connectors/index.js'
import { evaluateOffer } from '../filter/index.js'
import { normalizeOffer } from '../normalizer/index.js'
import { scoreOffer } from '../scorer/index.js'
import { getSettings } from '../settings/index.js'
import { saveRawOffer, upsertOffer } from '../tracker/index.js'

export async function runScan(db) {
  const settings = getSettings(db)
  const sources = settings.sources_actives.filter((name) => connectors[name])
  const startedAt = new Date().toISOString()
  const run = db.prepare('INSERT INTO scan_runs (started_at, status, sources) VALUES (?, ?, ?)').run(startedAt, 'running', JSON.stringify(sources))
  const scanRunId = run.lastInsertRowid
  let fetchedCount = 0
  let keptCount = 0

  try {
    for (const sourceName of sources) {
      const connector = connectors[sourceName]
      for (const keyword of settings.keywords) {
        let offers = []
        try {
          offers = await connector.fetchOffers(keyword)
        } catch (error) {
          console.warn(`[scan] ${sourceName}/${keyword}: ${error.message}`)
          continue
        }
        for (const raw of offers) {
          fetchedCount += 1
          const normalized = saveRawOffer(db, scanRunId, keyword, normalizeOffer(raw))
          const filterResult = evaluateOffer(normalized, settings)
          const scoring = scoreOffer(normalized, settings, filterResult)
          if (filterResult.keep || scoring.verdict !== 'à rejeter') {
            keptCount += 1
            upsertOffer(db, normalized, scoring)
          }
        }
      }
    }
    db.prepare(`
      UPDATE scan_runs
      SET finished_at = ?, status = ?, fetched_count = ?, kept_count = ?
      WHERE id = ?
    `).run(new Date().toISOString(), 'success', fetchedCount, keptCount, scanRunId)
    return { id: scanRunId, status: 'success', fetchedCount, keptCount }
  } catch (error) {
    db.prepare(`
      UPDATE scan_runs
      SET finished_at = ?, status = ?, fetched_count = ?, kept_count = ?, error = ?
      WHERE id = ?
    `).run(new Date().toISOString(), 'failed', fetchedCount, keptCount, error.message, scanRunId)
    throw error
  }
}
