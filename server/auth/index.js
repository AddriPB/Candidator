import crypto from 'node:crypto'

const COOKIE_NAME = 'opportunity_radar_session'

export function requireAuth(req, res, next) {
  if (verifySession(readCookie(req))) return next()
  res.status(401).json({ error: 'unauthorized' })
}

export function loginHandler(req, res) {
  const password = String(req.body?.password || '')
  if (!isValidPassword(password)) return res.status(401).json({ error: 'invalid_credentials' })
  const token = createSessionToken()
  res.setHeader('Set-Cookie', buildCookie(token))
  res.json({ ok: true })
}

export function logoutHandler(_req, res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
  res.json({ ok: true })
}

export function meHandler(req, res) {
  res.json({ authenticated: verifySession(readCookie(req)) })
}

function isValidPassword(password) {
  const hash = process.env.AUTH_PASSWORD_HASH
  if (hash) {
    const candidate = crypto.createHash('sha256').update(password).digest('hex')
    return timingSafe(candidate, hash)
  }
  const plain = process.env.AUTH_PASSWORD
  return Boolean(plain) && timingSafe(password, plain)
}

function createSessionToken() {
  const maxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS || 30)
  const expires = Date.now() + maxAgeDays * 24 * 60 * 60 * 1000
  const nonce = crypto.randomBytes(16).toString('hex')
  const payload = `${expires}.${nonce}`
  const sig = sign(payload)
  return `${payload}.${sig}`
}

function verifySession(token) {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [expires, nonce, sig] = parts
  if (Number(expires) < Date.now()) return false
  return timingSafe(sign(`${expires}.${nonce}`), sig)
}

function sign(payload) {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.AUTH_PASSWORD || 'dev-only-secret'
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

function buildCookie(token) {
  const maxAge = Number(process.env.SESSION_MAX_AGE_DAYS || 30) * 24 * 60 * 60
  const secure = process.env.AUTH_COOKIE_SECURE === 'true' ? '; Secure' : ''
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
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
