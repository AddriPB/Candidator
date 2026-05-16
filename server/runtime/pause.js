import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_PAUSE_PATH = './data/bot-pause.json'

export function getBotPause({ now = new Date(), env = process.env } = {}) {
  const pausePath = path.resolve(env.BOT_PAUSE_PATH || DEFAULT_PAUSE_PATH)
  let data
  try {
    data = JSON.parse(fs.readFileSync(pausePath, 'utf8'))
  } catch {
    return { active: false, pausePath }
  }

  const until = new Date(data.pauseUntil || data.until || '')
  if (Number.isNaN(until.getTime()) || until <= now) {
    return { active: false, pausePath, pauseUntil: data.pauseUntil || data.until || '' }
  }

  return {
    active: true,
    pausePath,
    pauseUntil: until.toISOString(),
    reason: String(data.reason || 'bot_paused'),
  }
}

export function exitIfBotPaused(options = {}) {
  const pause = getBotPause(options)
  if (!pause.active) return false
  console.log(`[bot] paused until ${pause.pauseUntil}: ${pause.reason}`)
  process.exit(0)
}
