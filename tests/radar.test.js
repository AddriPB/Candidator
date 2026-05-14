import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dedupeOffers } from '../server/radar/dedupe.js'
import { evaluateOffer } from '../server/radar/filter.js'
import { scoreOffer } from '../server/radar/scorer.js'
import { loginHandler, requireAuth } from '../server/auth/index.js'
import { getLatestRadarOffers, saveSourceCheckLogs } from '../server/storage/database.js'

const baseConfig = {
  contrat: 'CDI',
  salaire_min: 60000,
  keep_unknown_salary: true,
  reject_salary_below_threshold: true,
  blacklist_entreprises: [],
  blacklist_secteurs: [],
}

function offer(overrides = {}) {
  return {
    id: 'test:1',
    sourceId: '1',
    source: 'test',
    title: 'Product Owner',
    company: 'Example',
    location: 'Paris',
    remote: 'hybride 2 jours',
    contract: 'CDI',
    salaryMin: 65000,
    salaryMax: null,
    currency: 'EUR',
    publishedAt: '',
    link: 'https://example.test/job/1',
    description: 'Mission produit avec backlog, roadmap et utilisateurs métier.',
    level: '',
    collectedAt: '2026-05-13T00:00:00.000Z',
    ...overrides,
  }
}

test('filtrage rôle: accepte un rôle PO clair', () => {
  const evaluation = evaluateOffer(offer({ title: 'Product Owner confirmé' }), baseConfig)
  assert.equal(evaluation.role.status, 'clear')
  assert.equal(evaluation.status, 'compatible')
})

test('filtrage rôle: accepte les sigles PO PM BA MOA AMOA', () => {
  for (const title of ['PO confirmé', 'PM senior', 'BA assurance', 'Consultant MOA', 'AMOA finance']) {
    const evaluation = evaluateOffer(offer({ title }), baseConfig)
    assert.equal(evaluation.role.status, 'clear', title)
  }
})

test('filtrage rôle: rejette un poste sans rôle cible', () => {
  const evaluation = evaluateOffer(offer({ title: 'Chargé de recrutement', description: 'CDI Paris hybride.' }), baseConfig)
  assert.ok(evaluation.rejectReasons.includes('hors rôle'))
})

test('filtrage rôle: rejette un développeur IA pur', () => {
  const evaluation = evaluateOffer(offer({
    title: 'Développeur IA',
    description: 'Développement logiciel machine learning sans responsabilité produit.',
  }), baseConfig)
  assert.equal(evaluation.role.status, 'reject')
  assert.equal(evaluation.status, 'à rejeter')
})

test('filtrage CDI: rejette un CDD', () => {
  const evaluation = evaluateOffer(offer({ contract: 'CDD' }), baseConfig)
  assert.ok(evaluation.rejectReasons.includes('hors CDI'))
})

test('filtrage CDI: rejette freelance même si CDI apparaît ailleurs', () => {
  const evaluation = evaluateOffer(offer({
    title: 'Product Owner - Freelance',
    description: 'Mission Product Owner. Mots-clés proches CDI dans une annonce agrégée.',
  }), baseConfig)
  assert.ok(evaluation.rejectReasons.includes('hors CDI'))
})

test('filtrage zone: rejette une offre hors IDF sans remote', () => {
  const evaluation = evaluateOffer(offer({ location: 'Lyon', remote: '', description: 'Présentiel à Lyon.' }), baseConfig)
  assert.ok(evaluation.rejectReasons.includes('hors zone'))
})

test('rémunération inconnue: conserve en à vérifier si configuré', () => {
  const evaluation = evaluateOffer(offer({ salaryMin: null, salaryMax: null }), baseConfig)
  assert.equal(evaluation.salary.status, 'unknown')
  assert.ok(evaluation.warnings.includes('rémunération inconnue'))
})

test('verdict: salaire et télétravail inconnus restent à candidater sans rejet dur', () => {
  const candidate = offer({
    title: 'Business Analyst',
    remote: '',
    salaryMin: null,
    salaryMax: null,
    description: 'CDI Paris. Mission métier et produit.',
  })
  const evaluation = evaluateOffer(candidate, baseConfig)
  const scoring = scoreOffer(candidate, evaluation, baseConfig)
  assert.equal(scoring.verdict, 'à candidater')
})

test('scoring télétravail: full remote France donne 30 points', () => {
  const candidate = offer({ remote: 'full remote France', description: 'CDI Product Owner full remote France.' })
  const evaluation = evaluateOffer(candidate, baseConfig)
  const scoring = scoreOffer(candidate, evaluation, baseConfig)
  assert.equal(scoring.scoreDetails.remote, 30)
})

test('déduplication: fusionne deux offres avec le même lien', () => {
  const first = offer({ id: 'a', source: 'adzuna', sourceId: 'a' })
  const second = offer({ id: 'b', source: 'jsearch', sourceId: 'b' })
  const result = dedupeOffers([first, second])
  assert.equal(result.offers.length, 1)
  assert.equal(result.duplicates, 1)
  assert.deepEqual(result.offers[0].sources.sort(), ['adzuna', 'jsearch'])
})

test('stockage JSON: relit les runs écrits par un autre process', () => {
  const jsonPath = makeJsonStore({
    sourceChecks: [],
    radarRuns: [{
      startedAt: '2026-05-14T05:15:06.048Z',
      offers: [offer({ id: 'json:1', title: 'Product Manager' })],
    }],
  })
  const staleDb = { kind: 'json', path: jsonPath, data: { sourceChecks: [], radarRuns: [] } }

  const latest = getLatestRadarOffers(staleDb)

  assert.equal(latest.startedAt, '2026-05-14T05:15:06.048Z')
  assert.equal(latest.offers.length, 1)
  assert.equal(latest.offers[0].title, 'Product Manager')
})

test('stockage JSON: une écriture API ne supprime pas un run ajouté sur disque', () => {
  const jsonPath = makeJsonStore({
    sourceChecks: [],
    radarRuns: [{
      startedAt: '2026-05-14T05:15:06.048Z',
      offers: [offer({ id: 'json:1' })],
    }],
  })
  const staleDb = { kind: 'json', path: jsonPath, data: { sourceChecks: [], radarRuns: [] } }

  saveSourceCheckLogs(staleDb, [{
    checkedAt: '2026-05-14T06:00:00.000Z',
    source: 'adzuna',
    offersCount: 12,
    errorsCount: 0,
    error: '',
  }])

  const stored = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  assert.equal(stored.radarRuns.length, 1)
  assert.equal(stored.sourceChecks.length, 1)
})

test('auth: accepte le token de session via Authorization Bearer', () => {
  withAuthEnv(() => {
    const loginRes = mockResponse()
    loginHandler({
      body: { username: 'adrien', password: 'secret' },
      headers: {},
      secure: true,
    }, loginRes)

    assert.equal(loginRes.statusCode, 200)
    assert.ok(loginRes.body.token)

    let passed = false
    const authRes = mockResponse()
    requireAuth({
      headers: { authorization: `Bearer ${loginRes.body.token}` },
    }, authRes, () => {
      passed = true
    })

    assert.equal(passed, true)
    assert.equal(authRes.statusCode, 200)
  })
})

test('auth: rejette une requête protégée sans cookie ni Bearer', () => {
  withAuthEnv(() => {
    const res = mockResponse()
    requireAuth({ headers: {} }, res, () => {
      throw new Error('unexpected auth')
    })

    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.body, { error: 'unauthorized' })
  })
})

function makeJsonStore(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opportunity-radar-'))
  const jsonPath = path.join(dir, 'store.json')
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`)
  return jsonPath
}

function withAuthEnv(fn) {
  const previous = {
    AUTH_USERNAME: process.env.AUTH_USERNAME,
    AUTH_PASSWORD: process.env.AUTH_PASSWORD,
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
  }
  process.env.AUTH_USERNAME = 'adrien'
  process.env.AUTH_PASSWORD = 'secret'
  process.env.AUTH_SESSION_SECRET = 'test-secret'
  try {
    fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function mockResponse() {
  return {
    body: null,
    headers: {},
    statusCode: 200,
    json(body) {
      this.body = body
      return this
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    status(statusCode) {
      this.statusCode = statusCode
      return this
    },
  }
}
