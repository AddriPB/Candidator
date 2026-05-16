import 'dotenv/config'
import { exitIfBotPaused } from '../runtime/pause.js'
import { sendDailySpontaneousApplications } from '../applications/spontaneous.js'
import { loadRadarConfig } from '../radar/config.js'
import { openDatabase } from '../storage/database.js'

exitIfBotPaused()

const db = openDatabase()

try {
  const config = loadRadarConfig()
  const summary = await sendDailySpontaneousApplications({ db, config })
  console.log(`[spontaneous_application] candidates: ${summary.candidates}`)
  console.log(`[spontaneous_application] sent: ${summary.sent}`)
  console.log(`[spontaneous_application] skipped: ${summary.skipped}`)
  console.log(`[spontaneous_application] failed: ${summary.failed}`)
  if (summary.failed > 0) process.exitCode = 1
} catch (error) {
  console.error(`[spontaneous_application] run failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
