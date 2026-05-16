import 'dotenv/config'
import { exitIfBotPaused } from '../runtime/pause.js'
import { sendDailyApplicationEmails } from '../applications/emailer.js'
import { hasQuotaReachedLog } from '../radar/collector.js'
import { loadRadarConfig } from '../radar/config.js'
import { nightlyRunSucceeded, readNightlyState, recordNightlyAttempt, shouldRunNightlyRadar, writeNightlyState } from '../radar/nightlySchedule.js'
import { runDailyRadar } from '../radar/pipeline.js'
import { openDatabase } from '../storage/database.js'

exitIfBotPaused()

const config = loadRadarConfig()
const schedule = config.daily_run_schedule
const state = readNightlyState(schedule.state_path)
const decision = shouldRunNightlyRadar({ schedule, state })

if (!decision.run) {
  console.log(`[radar] nightly run skipped: ${decision.reason}`)
  process.exit(0)
}

const db = openDatabase()
const startedAt = new Date().toISOString()

try {
  const result = await runDailyRadar({ config, db, logger: console })
  if (!result) process.exit(0)

  console.log(`[radar] markdown: ${result.reports.markdownPath}`)
  console.log(`[radar] json: ${result.reports.jsonPath}`)

  if (process.env.APPLICATION_EMAIL_DAILY_ENABLED !== 'false') {
    const emailSummary = await sendDailyApplicationEmails({
      db,
      offers: result.offers,
      startedAt: result.startedAt,
    })
    console.log(`[applications] candidates: ${emailSummary.candidates}`)
    console.log(`[applications] sent: ${emailSummary.sent}`)
    console.log(`[applications] skipped: ${emailSummary.skipped}`)
    console.log(`[applications] failed: ${emailSummary.failed}`)
  }

  const quotaReached = hasQuotaReachedLog(result.logs)
  const success = nightlyRunSucceeded(result)
  writeNightlyState(schedule.state_path, recordNightlyAttempt({
    state,
    date: decision.date,
    startedAt,
    status: success ? 'success' : quotaReached ? 'quota_reached' : 'failed',
    detail: success ? 'ok' : failedSourcesDetail(result.logs),
  }))

  if (!success) {
    console.error(quotaReached
      ? '[radar] nightly run incomplete; quota reached, next attempt tomorrow'
      : '[radar] nightly run incomplete; a retry will be allowed later if the daily cap is not reached')
    process.exitCode = 1
  }
} catch (error) {
  writeNightlyState(schedule.state_path, recordNightlyAttempt({
    state,
    date: decision.date,
    startedAt,
    status: 'failed',
    detail: error.message,
  }))
  console.error(`[radar] nightly run failed: ${error.stack || error.message}`)
  process.exitCode = 1
}

function failedSourcesDetail(logs) {
  return logs
    .filter((log) => log.errorsCount)
    .map((log) => `${log.source}: ${log.errorsCount} error(s)${log.error ? ` - ${log.error}` : ''}`)
    .join('; ')
}
