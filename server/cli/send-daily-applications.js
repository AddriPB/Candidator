import 'dotenv/config'
import { sendDailyApplicationEmails } from '../applications/emailer.js'
import { openDatabase } from '../storage/database.js'

const db = openDatabase()

try {
  const summary = await sendDailyApplicationEmails({ db })
  console.log(`[applications] candidates: ${summary.candidates}`)
  console.log(`[applications] sent: ${summary.sent}`)
  console.log(`[applications] skipped: ${summary.skipped}`)
  console.log(`[applications] failed: ${summary.failed}`)
  if (summary.failed > 0) process.exitCode = 1
} catch (error) {
  console.error(`[applications] run failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
