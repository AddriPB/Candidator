import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginHandler, logoutHandler, meHandler, requireAuth } from './auth/index.js'
import { checkSources } from './connectors/sourceChecks.js'
import { openDatabase, pruneOldData, saveSourceCheckLogs } from './storage/database.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const db = openDatabase()
const pruned = pruneOldData(db)
const app = express()

app.use(express.json({ limit: '1mb' }))

app.use((req, res, next) => {
  const origin = req.headers.origin
  const allowed = String(process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean)
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'Opportunity Radar', retentionDays: Number(process.env.DATA_RETENTION_DAYS || 90) })
})

app.get('/api/auth/me', meHandler)
app.post('/api/auth/login', loginHandler)
app.post('/api/auth/logout', logoutHandler)

app.post('/api/source-check', requireAuth, async (_req, res, next) => {
  try {
    const checkedAt = new Date().toISOString()
    const checks = await checkSources()
    saveSourceCheckLogs(db, checks.map((check) => ({
      checkedAt,
      source: check.source,
      offersCount: Number.parseInt(check.detail, 10) || 0,
      errorsCount: check.ok ? 0 : 1,
      error: check.ok ? '' : check.detail,
    })))
    res.json({ checkedAt, checks })
  } catch (error) {
    next(error)
  }
})

app.get('/api/source-checks/latest', requireAuth, (_req, res) => {
  const rows = db.prepare(`
    SELECT source, status, detail, checked_at AS checkedAt
    FROM source_checks
    WHERE checked_at = (SELECT MAX(checked_at) FROM source_checks)
    ORDER BY source
  `).all()
  res.json({ checks: rows })
})

app.post('/api/admin/prune', requireAuth, (_req, res) => {
  res.json({ pruned: pruneOldData(db) })
})

const dist = path.join(projectRoot, 'dist')
app.use('/Opportunity-Radar', express.static(dist))
app.use(express.static(dist))
app.get(/^\/Opportunity-Radar\/.*$/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: 'internal_error' })
})

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 4173)
app.listen(port, host, () => {
  console.log(`Opportunity Radar API listening on http://${host}:${port}`)
  console.log(`Retention cleanup removed ${pruned.sourceChecks} source check row(s) before ${pruned.cutoff}`)
})
