import 'dotenv/config'
import { sendDailySpontaneousApplications } from '../applications/spontaneous.js'
import { openDatabase } from '../storage/database.js'

const db = openDatabase()

try {
  const summary = await sendDailySpontaneousApplications({ db })
  console.log(`[spontaneous_application] candidates: ${summary.candidates}`)
  console.log(`[spontaneous_application] sent: ${summary.sent}`)
  console.log(`[spontaneous_application] skipped: ${summary.skipped}`)
  console.log(`[spontaneous_application] failed: ${summary.failed}`)
  if (summary.failed > 0) process.exitCode = 1
} catch (error) {
  console.error(`[spontaneous_application] run failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
