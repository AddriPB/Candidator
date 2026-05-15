import fs from 'node:fs'
import path from 'node:path'

export function readNightlyState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(statePath), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

export function writeNightlyState(statePath, state) {
  const resolved = path.resolve(statePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(state, null, 2)}\n`)
}

export function shouldRunNightlyRadar({ schedule, state = {}, now = new Date() }) {
  const local = localParts(now, schedule.timezone)
  const dayState = state[local.date] || { attempts: [] }
  const attempts = Array.isArray(dayState.attempts) ? dayState.attempts : []
  const failures = attempts.filter((attempt) => attempt.status === 'failed').length
  const lastAttempt = attempts.at(-1)

  if (!schedule.night_hours.includes(local.hour)) {
    return { run: false, date: local.date, reason: `outside night window (${local.hour}h)` }
  }

  if (dayState.status === 'success') {
    return { run: false, date: local.date, reason: 'already succeeded today' }
  }

  if (dayState.status === 'quota_reached') {
    return { run: false, date: local.date, reason: 'quota reached; next attempt tomorrow' }
  }

  if (failures >= schedule.max_failures_per_day) {
    return { run: false, date: local.date, reason: `daily failure cap reached (${failures})` }
  }

  if (lastAttempt) {
    const elapsedMs = now.getTime() - new Date(lastAttempt.startedAt).getTime()
    const minDelayMs = schedule.retry_interval_hours * 60 * 60 * 1000
    if (elapsedMs < minDelayMs) {
      const nextAt = new Date(new Date(lastAttempt.startedAt).getTime() + minDelayMs).toISOString()
      return { run: false, date: local.date, reason: `retry not due before ${nextAt}` }
    }
  }

  return { run: true, date: local.date, reason: attempts.length ? 'retry due' : 'first nightly run' }
}

export function recordNightlyAttempt({ state = {}, date, startedAt, status, detail = '' }) {
  const next = { ...state }
  const current = next[date] || {}
  const attempts = Array.isArray(current.attempts) ? [...current.attempts] : []
  attempts.push({ startedAt, status, detail })
  next[date] = {
    status: status === 'success' || status === 'quota_reached' ? status : 'failed',
    attempts,
  }
  return pruneOldDays(next, date)
}

export function nightlyRunSucceeded(result) {
  return result && result.logs.every((log) => !log.errorsCount)
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  }
}

function pruneOldDays(state, today) {
  return Object.fromEntries(Object.entries(state).filter(([date]) => date >= today))
}
