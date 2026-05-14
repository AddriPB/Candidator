import 'dotenv/config'
import { loadRadarConfig } from '../radar/config.js'
import { runDailyRadar } from '../radar/pipeline.js'
import { sendDailyApplicationEmails } from '../applications/emailer.js'
import { openDatabase } from '../storage/database.js'

const config = loadRadarConfig()
const db = openDatabase()

try {
  const result = await runDailyRadar({ config, db })
  if (!result) process.exit(0)
  console.log(`[radar] markdown: ${result.reports.markdownPath}`)
  console.log(`[radar] json: ${result.reports.jsonPath}`)
  if (process.env.APPLICATION_EMAIL_DAILY_ENABLED !== 'false') {
    const emailSummary = await sendDailyApplicationEmails({
      db,
      startedAt: result.startedAt,
    })
    console.log(`[applications] candidates: ${emailSummary.candidates}`)
    console.log(`[applications] sent: ${emailSummary.sent}`)
    console.log(`[applications] skipped: ${emailSummary.skipped}`)
    console.log(`[applications] failed: ${emailSummary.failed}`)
  }
} catch (error) {
  console.error(`[radar] run failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
