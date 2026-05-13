import crypto from 'node:crypto'

const COOKIE_NAME = 'opportunity_radar_session'

export function requireAuth(req, res, next) {
  if (verifySession(readCookie(req))) return next()
  res.status(401).json({ error: 'unauthorized' })
}

export function loginHandler(req, res) {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')

  if (!hasAuthConfig()) {
    return res.status(503).json({ error: 'auth_not_configured' })
  }

  if (!isValidLogin(username, password)) {
    return res.status(401).json({ error: 'invalid_credentials' })
  }

  res.setHeader('Set-Cookie', buildCookie(createSessionToken()))
  res.json({ ok: true })
}

export function logoutHandler(_req, res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=${sameSite()}; Path=/; Max-Age=0${secureFlag()}`)
  res.json({ ok: true })
}

export function meHandler(req, res) {
  res.json({ authenticated: verifySession(readCookie(req)) })
}

function isValidLogin(username, password) {
  return timingSafe(username, process.env.AUTH_USERNAME || '') && timingSafe(password, process.env.AUTH_PASSWORD || '')
}

function hasAuthConfig() {
  return Boolean(process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD)
}

function createSessionToken() {
  const expires = Date.now() + Number(process.env.SESSION_MAX_AGE_DAYS || 30) * 24 * 60 * 60 * 1000
  const nonce = crypto.randomBytes(16).toString('hex')
  const payload = `${expires}.${nonce}`
  return `${payload}.${sign(payload)}`
}

function verifySession(token) {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [expires, nonce, sig] = parts
  if (Number(expires) < Date.now()) return false
  return timingSafe(sign(`${expires}.${nonce}`), sig)
}

function buildCookie(token) {
  const maxAge = Number(process.env.SESSION_MAX_AGE_DAYS || 30) * 24 * 60 * 60
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=${sameSite()}; Path=/; Max-Age=${maxAge}${secureFlag()}`
}

function secureFlag() {
  return process.env.AUTH_COOKIE_SECURE === 'true' ? '; Secure' : ''
}

function sameSite() {
  const value = process.env.AUTH_COOKIE_SAMESITE || 'Lax'
  return ['Strict', 'Lax', 'None'].includes(value) ? value : 'Lax'
}

function sign(payload) {
  const secret = process.env.AUTH_SESSION_SECRET || 'dev-only-secret'
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

function readCookie(req) {
  const cookie = req.headers.cookie || ''
  const match = cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : ''
}

function timingSafe(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
