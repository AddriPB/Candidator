import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import {
  getApplicationEmailSends,
  updateApplicationContactStatus,
  updateApplicationSendStatus,
} from '../storage/database.js'
import { parseDeliveryStatus } from './contactDiscovery.js'

export async function processApplicationBounces({ db, messages = [], now = new Date(), env = process.env, logger = console } = {}) {
  const parsed = messages.map(parseDeliveryStatus).filter((item) => item.attemptId || item.email)
  const bouncedAttemptIds = new Set()
  let hardBounced = 0
  let softBounced = 0

  const since = new Date(now.getTime() - positiveInteger(env.APPLICATION_EMAIL_BLOCK_MONTHS, 12) * 31 * 24 * 60 * 60 * 1000).toISOString()
  const sends = getApplicationEmailSends(db, { since })

  for (const bounce of parsed) {
    const send = sends.find((row) => (bounce.attemptId && row.attemptId === bounce.attemptId) || (bounce.email && row.contactEmail === bounce.email))
    if (!send) continue
    if (bounce.kind === 'hard') {
      if (send.attemptId) bouncedAttemptIds.add(send.attemptId)
      updateApplicationSendStatus(db, { attemptId: send.attemptId, status: 'hard_bounced', error: bounce.reason })
      updateApplicationContactStatus(db, {
        offerKey: send.offerKey,
        email: send.contactEmail || bounce.email,
        status: 'hard_bounced',
        bounceReason: bounce.reason,
      })
      hardBounced += 1
    } else if (bounce.kind === 'soft') {
      if (send.attemptId) bouncedAttemptIds.add(send.attemptId)
      updateApplicationSendStatus(db, { attemptId: send.attemptId, status: 'soft_bounced', error: bounce.reason })
      updateApplicationContactStatus(db, {
        offerKey: send.offerKey,
        email: send.contactEmail || bounce.email,
        status: 'retry_scheduled',
        bounceReason: bounce.reason,
      })
      softBounced += 1
    }
  }

  const graceHours = positiveInteger(env.APPLICATION_EMAIL_DELIVERY_GRACE_HOURS, 72)
  const graceCutoff = new Date(now.getTime() - graceHours * 60 * 60 * 1000).toISOString()
  let accepted = 0
  for (const send of sends) {
    if (bouncedAttemptIds.has(send.attemptId)) continue
    if (send.status !== 'sent_pending_delivery' || send.sentAt > graceCutoff) continue
    updateApplicationSendStatus(db, { attemptId: send.attemptId, status: 'delivered_or_no_bounce_after_grace_period' })
    updateApplicationContactStatus(db, {
      offerKey: send.offerKey,
      email: send.contactEmail || send.originalTo,
      status: 'delivered_or_no_bounce_after_grace_period',
    })
    accepted += 1
  }

  logger.log(`[applications] bounces: ${hardBounced} hard, ${softBounced} soft, ${accepted} accepted after grace`)
  return { hardBounced, softBounced, accepted, parsed: parsed.length }
}

export function readBounceMessagesFromDirectory(dir) {
  if (!dir || !fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .map((name) => fs.readFileSync(`${dir}/${name}`, 'utf8'))
}

export async function fetchBounceMessagesFromImap(env = process.env) {
  const host = env.APPLICATION_EMAIL_BOUNCE_IMAP_HOST
  const user = env.APPLICATION_EMAIL_BOUNCE_IMAP_USER
  const pass = env.APPLICATION_EMAIL_BOUNCE_IMAP_PASS
  if (!host || !user || !pass) return []

  const port = Number(env.APPLICATION_EMAIL_BOUNCE_IMAP_PORT || 993)
  const secure = String(env.APPLICATION_EMAIL_BOUNCE_IMAP_SECURE || 'true').toLowerCase() !== 'false'
  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port })
  socket.setEncoding('utf8')

  const client = new SimpleImapClient(socket)
  await client.ready()
  await client.command(`LOGIN ${quoteImap(user)} ${quoteImap(pass)}`)
  await client.command('SELECT INBOX')
  const search = await client.command('SEARCH UNSEEN')
  const ids = (search.match(/\* SEARCH ([^\r\n]*)/)?.[1] || '').trim().split(/\s+/).filter(Boolean).slice(0, 50)
  const messages = []
  for (const id of ids) {
    const response = await client.command(`FETCH ${id} BODY.PEEK[]`)
    messages.push(extractImapLiteral(response))
    await client.command(`STORE ${id} +FLAGS (\\Seen)`)
  }
  await client.command('LOGOUT').catch(() => {})
  socket.end()
  return messages.filter(Boolean)
}

class SimpleImapClient {
  constructor(socket) {
    this.socket = socket
    this.buffer = ''
    this.tag = 0
    socket.on('data', (chunk) => {
      this.buffer += chunk
    })
  }

  async ready() {
    await this.waitFor(/\* OK/)
  }

  async command(command) {
    const tag = `A${String(++this.tag).padStart(4, '0')}`
    this.socket.write(`${tag} ${command}\r\n`)
    return this.waitFor(new RegExp(`${tag} (OK|NO|BAD)`))
  }

  async waitFor(pattern) {
    const started = Date.now()
    while (!pattern.test(this.buffer)) {
      if (Date.now() - started > 15000) throw new Error('IMAP timeout')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const output = this.buffer
    this.buffer = ''
    return output
  }
}

function extractImapLiteral(response) {
  const match = response.match(/\{(\d+)\}\r?\n([\s\S]*)\r?\nA\d{4} OK/)
  if (!match) return response
  return match[2].slice(0, Number(match[1]))
}

function quoteImap(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}
