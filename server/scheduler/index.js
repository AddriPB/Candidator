import { runScan } from '../collector/index.js'

export function startScheduler(db) {
  if (process.env.SCHEDULER_ENABLED !== 'true') return null
  const minutes = Math.max(15, Number(process.env.SCHEDULER_INTERVAL_MINUTES || 360))
  const intervalMs = minutes * 60 * 1000
  console.log(`[scheduler] enabled, interval=${minutes} minutes`)
  return setInterval(() => {
    runScan(db).catch((error) => console.error('[scheduler] scan failed:', error))
  }, intervalMs)
}
