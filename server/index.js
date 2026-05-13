import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginHandler, logoutHandler, meHandler, requireAuth } from './auth/index.js'
import { runScan } from './collector/index.js'
import { ensureDefaultSettings, getSettings, updateSettings } from './settings/index.js'
import { openDatabase } from './storage/database.js'
import { listOffers, markOfferStatus, rowToOffer } from './tracker/index.js'
import { startScheduler } from './scheduler/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const db = openDatabase()
ensureDefaultSettings(db)

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/api/auth/me', meHandler)
app.post('/api/auth/login', loginHandler)
app.post('/api/auth/logout', logoutHandler)

app.get('/api/offers', requireAuth, (req, res) => {
  res.json({ offers: listOffers(db, req.query) })
})

app.patch('/api/offers/:id/status', requireAuth, (req, res) => {
  const row = markOfferStatus(db, Number(req.params.id), String(req.body.status || 'new'))
  res.json({ offer: rowToOffer(row) })
})

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json({ settings: getSettings(db) })
})

app.put('/api/settings', requireAuth, (req, res) => {
  res.json({ settings: updateSettings(db, req.body || {}) })
})

app.post('/api/scan', requireAuth, async (_req, res, next) => {
  try {
    res.json({ run: await runScan(db) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/health', (_req, res) => {
  const latest = db.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1').get()
  const offers = db.prepare('SELECT COUNT(*) AS count FROM offers').get().count
  res.json({ ok: true, offers, latestScan: latest || null })
})

const dist = path.join(projectRoot, 'dist')
app.use(express.static(dist))
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: 'internal_error', message: error.message })
})

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 4173)
app.listen(port, host, () => {
  console.log(`Opportunity Radar listening on http://${host}:${port}`)
})

startScheduler(db)
