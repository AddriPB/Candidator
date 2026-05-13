import 'dotenv/config'
import { loadRadarConfig } from '../radar/config.js'
import { runDailyRadar } from '../radar/pipeline.js'
import { openDatabase } from '../storage/database.js'

const config = loadRadarConfig()
const db = openDatabase()

try {
  const result = await runDailyRadar({ config, db })
  if (!result) process.exit(0)
  console.log(`[radar] markdown: ${result.reports.markdownPath}`)
  console.log(`[radar] json: ${result.reports.jsonPath}`)
} catch (error) {
  console.error(`[radar] run failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
