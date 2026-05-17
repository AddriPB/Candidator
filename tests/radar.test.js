import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dedupeOffers } from '../server/radar/dedupe.js'
import { collectOffers, hasQuotaReachedLog } from '../server/radar/collector.js'
import { evaluateOffer } from '../server/radar/filter.js'
import { normalizeOffer } from '../server/radar/normalizer.js'
import { scoreOffer } from '../server/radar/scorer.js'
import { loginHandler, requireAuth } from '../server/auth/index.js'
import { buildApplicationContextFromProfile, buildApplicationMessage, sendDailyApplicationEmails } from '../server/applications/emailer.js'
import { classifyApplicationType } from '../server/applications/templates.js'
import { buildSpontaneousApplicationMessage, sendDailySpontaneousApplications } from '../server/applications/spontaneous.js'
import { buildEsnDiscoveryOffers, buildWebDiscoveryOffers, discoverContactsForOffer, discoverEsnRecruiterContacts, discoverWebRecruiterContacts, extractMailtoEmails, inferRecruiterLocals } from '../server/applications/contactDiscovery.js'
import { processApplicationBounces } from '../server/applications/bounces.js'
import { cvPseudo, getCvState, saveApplicationMailTemplate, saveCvUpload, setActiveCv } from '../server/cv/storage.js'
import { getAllApplicationContacts, getApplicationContacts, getApplicationEmailEligibleOffers, getLatestRadarOffers, openDatabase, saveRadarRun, saveSourceCheckLogs } from '../server/storage/database.js'
import { nightlyRunSucceeded, recordNightlyAttempt, shouldRunNightlyRadar } from '../server/radar/nightlySchedule.js'
import { isQuotaReachedError, QUOTA_REACHED_CODE } from '../server/radar/adapters/jsearch.js'
import { loadCandidateProfiles, selectCandidateProfile } from '../server/profiles/config.js'

process.env.CANDIDATE_PROFILES_CONFIG = path.join(os.tmpdir(), 'opportunity-radar-test-missing-profiles.json')

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
    description: 'Mission adri avec backlog, roadmap et utilisateurs métier.',
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

test('filtrage rôle: accepte les sigles et intitulés cibles sans abréviation PM isolée', () => {
  for (const title of ['PO confirmé', 'Product Manager senior', 'BA assurance', 'Consultant MOA', 'Chef de projet AMOA finance']) {
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
    description: 'Développement logiciel machine learning sans responsabilité adri.',
  }), baseConfig)
  assert.equal(evaluation.role.status, 'reject')
  assert.equal(evaluation.status, 'à rejeter')
})

test('filtrage rôle: rejette un rôle cible seulement présent dans la description', () => {
  const candidate = offer({
    title: 'Développeur logiciel - équipe adri',
    description: 'CDI Paris hybride. Poste recherché Product Owner senior pour piloter le backlog et coordonner le développement.',
  })
  const evaluation = evaluateOffer(candidate, baseConfig)
  const scoring = scoreOffer(candidate, evaluation, baseConfig)

  assert.equal(evaluation.role.status, 'reject')
  assert.equal(evaluation.status, 'à rejeter')
  assert.equal(scoring.verdict, 'à rejeter')
  assert.ok(evaluation.rejectReasons.includes('hors rôle'))
})

test('filtrage rôle: rejette les faux positifs PM et métiers hors cible', () => {
  for (const title of [
    'Chef du service juridique H/F',
    'Charge Prevention Risques Professionnels',
    'gardien police municipale pm H/F',
    'Contract Manager - Maitrise d\'Ouvrage F/H',
  ]) {
    const evaluation = evaluateOffer(offer({
      title,
      description: 'CDI Paris hybride. Description agrégée mentionnant Product Owner, PM, BA ou MOA.',
    }), baseConfig)

    assert.equal(evaluation.role.status, 'reject', title)
    assert.ok(evaluation.rejectReasons.includes('hors rôle'), title)
  }
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
    description: 'CDI Paris. Mission métier et adri.',
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

test('normalisation: extrait les emails présents dans les données API', () => {
  const candidate = normalizeOffer({
    source: 'test',
    sourceId: '1',
    title: 'Product Owner',
    company: 'Example',
    description: 'Candidature à jobs@example.fr ou RH@EXAMPLE.fr.',
    raw: { contact: { email: 'talent@example.com' } },
  })

  assert.deepEqual(candidate.emails, ['jobs@example.fr', 'rh@example.fr', 'talent@example.com'])
  assert.equal(candidate.hasEmail, true)
})

test('déduplication: fusionne les emails détectés', () => {
  const first = offer({ id: 'a', source: 'adzuna', sourceId: 'a', emails: ['a@example.fr'], hasEmail: true })
  const second = offer({ id: 'b', source: 'jsearch', sourceId: 'b', emails: ['b@example.fr', 'a@example.fr'], hasEmail: true })
  const result = dedupeOffers([first, second])

  assert.deepEqual(result.offers[0].emails, ['a@example.fr', 'b@example.fr'])
  assert.equal(result.offers[0].hasEmail, true)
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

test('stockage JSON: recharge les rapports radar quand le fallback JSON est vide', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-reports-'))
  const reportDir = path.join(dir, 'radar-runs')
  fs.mkdirSync(reportDir)
  const jsonPath = path.join(dir, 'store.json')
  fs.writeFileSync(jsonPath, `${JSON.stringify({ sourceChecks: [], radarRuns: [] }, null, 2)}\n`)
  fs.writeFileSync(path.join(reportDir, 'opportunity-radar-2026-05-14.json'), `${JSON.stringify({
    startedAt: '2026-05-14T08:40:23.033Z',
    summary: {},
    logs: [],
    offers: [offer({ id: 'report:1', title: 'Business Analyst' })],
  }, null, 2)}\n`)
  const db = { kind: 'json', path: jsonPath, reportFallbackDir: reportDir, data: { sourceChecks: [], radarRuns: [] } }

  const latest = getLatestRadarOffers(db)

  assert.equal(latest.startedAt, '2026-05-14T08:40:23.033Z')
  assert.equal(latest.offers.length, 1)
  assert.equal(latest.offers[0].title, 'Business Analyst')
})

test('stockage JSON: expose les emails des offres publiques', () => {
  const jsonPath = makeJsonStore({
    sourceChecks: [],
    radarRuns: [{
      startedAt: '2026-05-14T05:15:06.048Z',
      offers: [offer({ id: 'json:1', emails: ['contact@example.fr'], hasEmail: true })],
    }],
  })
  const db = { kind: 'json', path: jsonPath, data: { sourceChecks: [], radarRuns: [] } }

  const latest = getLatestRadarOffers(db)

  assert.deepEqual(latest.offers[0].emails, ['contact@example.fr'])
  assert.equal(latest.offers[0].hasEmail, true)
})

test('stockage JSON: masque les offres rejetées déjà présentes', () => {
  const jsonPath = makeJsonStore({
    sourceChecks: [],
    radarRuns: [{
      startedAt: '2026-05-14T05:15:06.048Z',
      offers: [
        offer({ id: 'json:1', title: 'Product Manager', verdict: 'à candidater' }),
        offer({ id: 'json:2', title: 'Développeur IA', verdict: 'à rejeter' }),
      ],
    }],
  })
  const db = { kind: 'json', path: jsonPath, data: { sourceChecks: [], radarRuns: [] } }

  const latest = getLatestRadarOffers(db)

  assert.equal(latest.offers.length, 1)
  assert.equal(latest.offers[0].id, 'json:1')
})

test('stockage JSON: ne persiste pas les offres rejetées', () => {
  const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [] })
  const db = { kind: 'json', path: jsonPath, data: { sourceChecks: [], radarRuns: [] } }

  saveRadarRun(db, {
    startedAt: '2026-05-14T05:15:06.048Z',
    summary: {},
    logs: [],
    offers: [
      offer({ id: 'json:1', title: 'Product Manager', verdict: 'à candidater' }),
      offer({ id: 'json:2', title: 'Développeur IA', verdict: 'à rejeter' }),
    ],
    reports: { markdownPath: '', jsonPath: '' },
  })

  const stored = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  assert.equal(stored.radarRuns[0].offers.length, 1)
  assert.equal(stored.radarRuns[0].offers[0].id, 'json:1')
})

test('stockage JSON: journalise les emails de toutes les offres, même rejetées', () => {
  const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [] })
  const db = { kind: 'json', path: jsonPath, data: { sourceChecks: [], radarRuns: [], offerEmails: [] } }

  saveRadarRun(db, {
    startedAt: '2026-05-14T05:15:06.048Z',
    summary: {},
    logs: [],
    offers: [
      offer({ id: 'json:1', title: 'Product Manager', verdict: 'à candidater', emails: ['apply@example.fr'], hasEmail: true }),
      offer({ id: 'json:2', title: 'Développeur IA', verdict: 'à rejeter', emails: ['reject@example.fr'], hasEmail: true }),
    ],
    reports: { markdownPath: '', jsonPath: '' },
  })

  const stored = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  assert.deepEqual(stored.offerEmails.map((row) => row.email).sort(), ['apply@example.fr', 'reject@example.fr'])
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

test('stockage JSON: liste les offres avec email publiees depuis moins de 12 mois', () => {
  const jsonPath = makeJsonStore({
    sourceChecks: [],
    radarRuns: [{
      startedAt: '2026-05-14T05:15:06.048Z',
      offers: [
        offer({ id: 'recent-apply', link: 'https://example.test/recent-apply', verdict: 'à candidater', publishedAt: '2026-01-10T00:00:00.000Z', emails: ['apply@example.fr'], hasEmail: true }),
        offer({ id: 'recent-watch', link: 'https://example.test/recent-watch', verdict: 'à surveiller', publishedAt: '2026-01-11T00:00:00.000Z', emails: ['watch@example.fr'], hasEmail: true }),
        offer({ id: 'recent-no-email', link: 'https://example.test/recent-no-email', verdict: 'à candidater', publishedAt: '2026-01-12T00:00:00.000Z', emails: [], hasEmail: false }),
        offer({ id: 'old', link: 'https://example.test/old', verdict: 'à candidater', publishedAt: '2024-01-10T00:00:00.000Z', emails: ['old@example.fr'], hasEmail: true }),
      ],
    }],
  })
  const db = { kind: 'json', path: jsonPath, data: { sourceChecks: [], radarRuns: [] } }

  const result = getApplicationEmailEligibleOffers(db, { now: new Date('2026-05-14T08:00:00.000Z') })

  assert.deepEqual(result.offers.map((item) => item.id).sort(), ['recent-apply', 'recent-watch'])
})

test('stockage JSON: un chemin .json explicite ne tente pas SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opportunity-radar-json-'))
  const previousDatabasePath = process.env.DATABASE_PATH
  const jsonPath = path.join(dir, 'store.json')
  const originalWarn = console.warn
  const warnings = []

  try {
    process.env.DATABASE_PATH = jsonPath
    console.warn = (...args) => warnings.push(args.join(' '))
    const db = openDatabase()

    assert.equal(db.kind, 'json')
    assert.equal(db.path, jsonPath)
    assert.deepEqual(warnings, [])
  } finally {
    console.warn = originalWarn
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previousDatabasePath
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('stockage SQLite: importe le store JSON existant si le binaire SQLite est disponible', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opportunity-radar-sqlite-'))
  const previousDatabasePath = process.env.DATABASE_PATH
  const sqlitePath = path.join(dir, 'store.sqlite')
  const jsonPath = path.join(dir, 'store.json')
  fs.writeFileSync(jsonPath, `${JSON.stringify({
    sourceChecks: [],
    radarRuns: [],
    offerEmails: [],
    applicationEmailSends: [],
    applicationContacts: [{
      offerKey: 'id:web:recruteurs-idf-esn',
      email: 'rh@example-esn.fr',
      method: 'web_public_page',
      sourceUrl: 'https://example-esn.fr/contact',
      confidence: 90,
      status: 'candidate',
      lastAttemptAt: '',
      bounceReason: '',
      attempts: 0,
      updatedAt: '2026-05-15T08:00:00.000Z',
    }],
  }, null, 2)}\n`)

  try {
    process.env.DATABASE_PATH = sqlitePath
    const db = openDatabase()
    const contacts = getAllApplicationContacts(db)
    assert.equal(contacts.length, 1)
    assert.equal(contacts[0].email, 'rh@example-esn.fr')
    if (db.kind === 'sqlite') db.db.close()
  } finally {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previousDatabasePath
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('planification nocturne: autorise le premier appel pendant la nuit', () => {
  const decision = shouldRunNightlyRadar({
    schedule: nightlySchedule(),
    state: {},
    now: new Date('2026-05-14T00:15:00.000Z'),
  })

  assert.equal(decision.run, true)
  assert.equal(decision.date, '2026-05-14')
})

test('planification nocturne: bloque les retries avant 2 heures', () => {
  const state = recordNightlyAttempt({
    state: {},
    date: '2026-05-14',
    startedAt: '2026-05-14T00:15:00.000Z',
    status: 'failed',
    detail: 'HTTP 429',
  })

  const decision = shouldRunNightlyRadar({
    schedule: nightlySchedule(),
    state,
    now: new Date('2026-05-14T00:45:00.000Z'),
  })

  assert.equal(decision.run, false)
  assert.match(decision.reason, /retry not due/)
})

test('planification nocturne: ne retente pas après 3 échecs le même jour', () => {
  let state = {}
  for (const startedAt of [
    '2026-05-14T00:15:00.000Z',
    '2026-05-14T02:15:00.000Z',
    '2026-05-14T04:15:00.000Z',
  ]) {
    state = recordNightlyAttempt({ state, date: '2026-05-14', startedAt, status: 'failed', detail: 'HTTP 500' })
  }

  const decision = shouldRunNightlyRadar({
    schedule: nightlySchedule(),
    state,
    now: new Date('2026-05-14T04:30:00.000Z'),
  })

  assert.equal(decision.run, false)
  assert.match(decision.reason, /daily failure cap/)
})

test('planification nocturne: ne retente pas le meme jour apres quota atteint', () => {
  const state = recordNightlyAttempt({
    state: {},
    date: '2026-05-14',
    startedAt: '2026-05-14T00:15:00.000Z',
    status: 'quota_reached',
    detail: 'jsearch: HTTP 429 - quota reached',
  })

  const sameDay = shouldRunNightlyRadar({
    schedule: nightlySchedule(),
    state,
    now: new Date('2026-05-14T02:15:00.000Z'),
  })
  const nextDay = shouldRunNightlyRadar({
    schedule: nightlySchedule(),
    state,
    now: new Date('2026-05-15T00:15:00.000Z'),
  })

  assert.equal(sameDay.run, false)
  assert.match(sameDay.reason, /quota reached/)
  assert.equal(nextDay.run, true)
})

test('planification nocturne: un succès bloque les créneaux suivants', () => {
  const state = recordNightlyAttempt({
    state: {},
    date: '2026-05-14',
    startedAt: '2026-05-14T00:15:00.000Z',
    status: 'success',
    detail: 'ok',
  })

  const decision = shouldRunNightlyRadar({
    schedule: nightlySchedule(),
    state,
    now: new Date('2026-05-14T02:15:00.000Z'),
  })

  assert.equal(decision.run, false)
  assert.equal(decision.reason, 'already succeeded today')
})

test('planification nocturne: une erreur source rend le run incomplet', () => {
  assert.equal(nightlyRunSucceeded({ logs: [{ source: 'adzuna', errorsCount: 0 }] }), true)
  assert.equal(nightlyRunSucceeded({ logs: [{ source: 'adzuna', errorsCount: 1 }] }), false)
})

test('collecte: arrete JSearch au premier code quota atteint', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.RAPIDAPI_KEY
  let calls = 0
  process.env.RAPIDAPI_KEY = 'test-key'
  globalThis.fetch = async () => {
    calls += 1
    return {
      ok: false,
      status: 429,
      text: async () => '{"message":"You have exceeded the quota"}',
    }
  }

  try {
    const result = await collectOffers({ sources_actives: ['jsearch'] }, {
      collectedAt: '2026-05-14T00:15:00.000Z',
      logger: silentLogger(),
    })

    assert.equal(calls, 1)
    assert.equal(result.logs[0].errorsCount, 1)
    assert.equal(result.logs[0].stoppedReason, 'quota_reached')
    assert.equal(hasQuotaReachedLog(result.logs), true)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.RAPIDAPI_KEY
    else process.env.RAPIDAPI_KEY = originalKey
  }
})

test('jsearch: detecte explicitement les erreurs de quota', () => {
  const explicit = new Error('HTTP 403 - usage limit exceeded')
  const coded = new Error('API Hub quota')
  coded.code = QUOTA_REACHED_CODE

  assert.equal(isQuotaReachedError(explicit), true)
  assert.equal(isQuotaReachedError(coded), true)
  assert.equal(isQuotaReachedError(new Error('HTTP 500')), false)
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

test('cv: stocke les fichiers dans le sous-dossier du pseudo', () => {
  withCvEnv(() => {
    const state = saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })

    assert.equal(cvPseudo(), 'adrien-test')
    assert.equal(state.pseudo, 'adrien-test')
    assert.ok(state.storageDir.endsWith(path.join('cv', 'adrien-test')))
    assert.equal(state.files.length, 1)
    assert.equal(state.activeFile, 'CV Adri.pdf')
    assert.equal(state.files[0].name, 'CV Adri.pdf')
  })
})

test('cv: conserve le nom du CV et suffixe seulement les doublons', () => {
  withCvEnv(() => {
    const first = saveCvUpload({
      originalName: 'Adrien Pujol Bertomeu.pdf',
      buffer: Buffer.from('%PDF-1.4 first'),
    })
    const second = saveCvUpload({
      originalName: 'Adrien Pujol Bertomeu.pdf',
      buffer: Buffer.from('%PDF-1.4 second'),
    })

    assert.equal(first.activeFile, 'Adrien Pujol Bertomeu.pdf')
    assert.equal(second.activeFile, 'Adrien Pujol Bertomeu (2).pdf')
    assert.deepEqual(second.files.map((file) => file.name).sort(), [
      'Adrien Pujol Bertomeu (2).pdf',
      'Adrien Pujol Bertomeu.pdf',
    ])
  })
})

test('cv: liste un CV ajoute manuellement et permet de le rendre actif', () => {
  withCvEnv(() => {
    const initial = getCvState()
    const manualPath = path.join(initial.storageDir, 'manual.docx')
    fs.writeFileSync(manualPath, 'docx')

    const updated = setActiveCv('manual.docx')

    assert.equal(updated.files.some((file) => file.name === 'manual.docx'), true)
    assert.equal(updated.activeFile, 'manual.docx')
  })
})

test('cv: utilise adri comme pseudo par defaut', () => {
  withCvEnv(() => {
    delete process.env.CV_USER_PSEUDO
    delete process.env.AUTH_USERNAME

    assert.equal(cvPseudo(), 'adri')
    assert.ok(getCvState().storageDir.endsWith(path.join('cv', 'adri')))
  })
})

test('cv: utilise le dossier runtime du projet par defaut', () => {
  withCvEnv(() => {
    delete process.env.CV_STORAGE_DIR
    delete process.env.OPPORTUNITY_RADAR_PRIVATE_DIR
    process.env.CV_USER_PSEUDO = 'adri'
    const runtimeCvRoot = path.resolve('cv')
    const runtimeCvRootExisted = fs.existsSync(runtimeCvRoot)

    const state = getCvState()

    assert.equal(state.storageDir, path.resolve('cv', 'adri'))
    assert.equal(state.storageDir.includes('/home/pi/opportunity-radar-private'), false)
    if (!runtimeCvRootExisted) fs.rmSync(runtimeCvRoot, { recursive: true, force: true })
  })
})

test('cv: stocke le mail de candidature dans le dossier du pseudo', () => {
  withCvEnv(() => {
    const state = saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour, poste [Intitulé du poste]. Tel 06 00 00 00 00. Adrien Pujol',
    })

    assert.equal(state.applicationMail.firstName, 'Adrien')
    assert.equal(state.applicationMail.lastName, 'Pujol')
    assert.equal(state.applicationMail.phone, '06 00 00 00 00')
    assert.equal(state.applicationMail.titlePlaceholder, '[Intitulé du poste]')
    assert.equal(state.applicationMail.subjectTemplate, 'Candidature : [Intitulé du poste]')
    assert.ok(fs.existsSync(path.join(state.storageDir, '.application-mail.json')))
    assert.equal(getCvState().applicationMail.bodyTemplate.includes('[Intitulé du poste]'), true)
  })
})

test('cv: separe les imports et identites par profil', () => {
  withCvEnv(() => {
    const adri = saveCvUpload({
      pseudo: 'adri',
      originalName: 'CV-adri.pdf',
      buffer: Buffer.from('%PDF adri'),
    })
    const léna = saveCvUpload({
      pseudo: 'léna',
      originalName: 'CV-lena.pdf',
      buffer: Buffer.from('%PDF lena'),
    })

    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Adri',
      phone: '0600000001',
    }, { pseudo: 'adri' })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Lena',
      phone: '0600000002',
    }, { pseudo: 'léna' })

    assert.equal(adri.storageDir.endsWith(path.join('cv', 'adri')), true)
    assert.equal(léna.storageDir.endsWith(path.join('cv', 'léna')), true)
    assert.equal(getCvState({ pseudo: 'adri' }).activeFile, 'CV-adri.pdf')
    assert.equal(getCvState({ pseudo: 'léna' }).activeFile, 'CV-lena.pdf')
    assert.equal(getCvState({ pseudo: 'adri' }).applicationMail.phone, '0600000001')
    assert.equal(getCvState({ pseudo: 'léna' }).applicationMail.phone, '0600000002')
  })
})

test('cv: conserve les accents dans le pseudo de profil', () => {
  withCvEnv(() => {
    const state = saveCvUpload({
      pseudo: 'Léna',
      originalName: 'CV-lena.pdf',
      buffer: Buffer.from('%PDF lena'),
    })

    assert.equal(state.pseudo, 'léna')
    assert.equal(state.storageDir.endsWith(path.join('cv', 'léna')), true)
    assert.equal(getCvState({ pseudo: 'léna' }).activeFile, 'CV-lena.pdf')
  })
})

test('candidatures: rend le mail avec le titre de chaque annonce', () => {
  const message = buildApplicationMessage({
    offer: offer({ title: 'Business Analyst Assurance' }),
    context: {
      applicationMail: {
        subjectTemplate: 'Candidature : [Intitulé du poste]',
        bodyTemplate: 'Je vous adresse ma candidature pour le poste de [Intitulé du poste].\n\nVous trouverez mon CV en pièce jointe.',
      },
    },
  })

  assert.equal(message.subject, 'Candidature : Business Analyst Assurance')
  assert.equal(message.text, 'Je vous adresse ma candidature pour le poste de Business Analyst Assurance.\n\nOffre concernée : https://example.test/job/1\n\nVous trouverez mon CV en pièce jointe.')
})

test('candidatures: envoie un mail par annonce recente meme avec la meme boite mail', async () => {
  await withCvEnv(async () => {
    saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour [Intitulé du poste]\n[Prénom Nom]\n[Téléphone]',
    })

    const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [] })
    const db = { kind: 'json', path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
    const sent = []
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'test', APPLICATION_EMAIL_REDIRECT_TO: 'test-capture@example.fr' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: `message-${sent.length}` }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'offer:1', title: 'Product Owner', link: 'https://example.test/job/1', verdict: 'à candidater', emails: ['rh@example.fr'] }),
        offer({ id: 'offer:2', title: 'Product Manager', link: 'https://example.test/job/2', verdict: 'à surveiller', emails: ['rh@example.fr'] }),
      ],
      startedAt: '2026-05-14T07:55:00.000Z',
    })

    assert.equal(summary.sent, 2)
    assert.equal(sent.length, 2)
    assert.deepEqual(sent.map((message) => message.to), ['test-capture@example.fr', 'test-capture@example.fr'])
    assert.deepEqual(sent.map((message) => message.subject), [
      'Candidature : Product Owner',
      'Candidature : Product Manager',
    ])
    assert.equal(sent.every((message) => message.attachments?.[0]?.filename === 'CV Adri.pdf'), true)
  })
})

test('candidatures: bloque un nouvel envoi sur la meme annonce pendant 12 mois', async () => {
  await withCvEnv(async () => {
    saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour [Intitulé du poste]',
    })

    const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [] })
    const db = { kind: 'json', path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
    const sent = []
    const options = {
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'test', APPLICATION_EMAIL_REDIRECT_TO: 'test-capture@example.fr' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: `message-${sent.length}` }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'offer:1', title: 'Product Owner', verdict: 'à candidater', emails: ['rh@example.fr'] }),
      ],
      startedAt: '2026-05-14T07:55:00.000Z',
    }

    const first = await sendDailyApplicationEmails(options)
    const second = await sendDailyApplicationEmails(options)

    assert.equal(first.sent, 1)
    assert.equal(second.sent, 0)
    assert.equal(second.skipped, 1)
    assert.equal(sent.length, 1)
  })
})

test('candidatures: bloque le mode test sans redirection explicite', async () => {
  await withCvEnv(async () => {
    saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour [Intitulé du poste]',
    })

    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'test' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'offer:test-mode', title: 'Product Owner', verdict: 'à candidater', emails: ['rh@example.fr'] }),
      ],
      startedAt: '2026-05-14T07:55:00.000Z',
    })

    assert.equal(summary.sent, 0)
    assert.equal(summary.skipped, 1)
    assert.equal(sent.length, 0)
    assert.equal(summary.results[0].reason, 'test_redirect_missing')
  })
})

test('candidatures: bloque les envois hors fenetre 08h-21h Paris', async () => {
  await withCvEnv(async () => {
    saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour [Intitulé du poste]',
    })

    const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [] })
    const db = { kind: 'json', path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
    const sent = []
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-14T05:59:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'offer:window', title: 'Product Owner', verdict: 'à candidater', emails: ['rh@example.fr'] }),
      ],
      startedAt: '2026-05-14T05:55:00.000Z',
    })

    assert.equal(summary.sent, 0)
    assert.equal(summary.skipped, 1)
    assert.equal(sent.length, 0)
    assert.equal(summary.results[0].reason, 'outside_send_window_Europe/Paris_08:00-21:00')
  })
})

test('candidatures: autorise les envois dans la fenetre 08h-21h Paris', async () => {
  await withCvEnv(async () => {
    saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour [Intitulé du poste]',
    })

    const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [] })
    const db = { kind: 'json', path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
    const sent = []
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-14T06:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'offer:window', title: 'Product Owner', verdict: 'à candidater', emails: ['rh@example.fr'] }),
      ],
      startedAt: '2026-05-14T05:55:00.000Z',
    })

    assert.equal(summary.sent, 1)
    assert.equal(sent.length, 1)
  })
})

test('contacts recruteurs: extrait mailto et rejette les faux emails', async () => {
  const contacts = await discoverContactsForOffer(offer({
    id: 'offer:contact',
    emails: ['votre.nom@email.com', 'talent@example.fr'],
    raw: {
      contact: { coordonnees1: 'https://jobs.example.fr/apply' },
      employer_website: 'https://example.fr',
    },
  }), {
    offerKey: 'offer:contact',
    fetchPages: true,
    fetcher: async () => ({
      ok: true,
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<a href="mailto:recrutement@example.fr">RH</a> john.doe@example.com',
    }),
  })

  assert.deepEqual(contacts.map((item) => item.email).slice(0, 2), ['talent@example.fr', 'recrutement@example.fr'])
  assert.equal(contacts.some((item) => item.email === 'votre.nom@email.com'), false)
  assert.deepEqual(extractMailtoEmails('<a href="mailto:jobs@example.fr?subject=Candidature">'), ['jobs@example.fr'])
})

test('contacts recruteurs: infere des adresses depuis un recruteur public', () => {
  const locals = inferRecruiterLocals(offer({
    raw: { contact: { nom: 'ACCESSOL - Mme Laura Letreguilly' } },
  }))

  assert.ok(locals.includes('laura.letreguilly'))
  assert.ok(locals.includes('l.letreguilly'))
})

test('contacts ESN: decouvre RH et commerciaux depuis les entreprises configurees', async () => {
  const config = {
    esn_contact_discovery: {
      enabled: true,
      max_pages_per_company: 2,
      companies: [{ name: 'Acme ESN', domain: 'acme-esn.fr', url: 'https://acme-esn.fr/' }],
    },
  }
  const fetched = []
  const contacts = await discoverEsnRecruiterContacts(config, {
    fetcher: async (url) => {
      fetched.push(url)
      return {
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<a href="mailto:talent@acme-esn.fr">RH</a><a href="mailto:business@acme-esn.fr">Business</a>',
      }
    },
  })

  assert.equal(buildEsnDiscoveryOffers(config.esn_contact_discovery).length, 1)
  assert.equal(fetched.length, 2)
  assert.ok(contacts.some((item) => item.offerKey === 'id:esn:acme-esn' && item.email === 'talent@acme-esn.fr'))
  assert.ok(contacts.some((item) => item.email === 'business@acme-esn.fr'))
  assert.ok(contacts.some((item) => item.email === 'commercial@acme-esn.fr'))
})

test('contacts web: extrait les emails trouvables via une recherche publique', async () => {
  const config = {
    web_contact_discovery: {
      enabled: true,
      max_results_per_query: 3,
      max_pages_per_query: 1,
      queries: [{ label: 'Recruteurs IDF ESN', query: 'recruteur IDF ESN email recrutement' }],
    },
  }
  const fetched = []
  const contacts = await discoverWebRecruiterContacts(config, {
    fetcher: async (url) => {
      fetched.push(url)
      if (String(url).includes('duckduckgo')) {
        return {
          ok: true,
          headers: new Map([['content-type', 'text/html']]),
          text: async () => `
            contact visible: rh-public@example-esn.fr
            <a class="result__a" href="/l/?uddg=${encodeURIComponent('https://cabinet.example-esn.fr/recruteur-idf')}">Result</a>
            <a class="result__a" href="/l/?uddg=${encodeURIComponent('https://www.linkedin.com/company/example')}">Ignored</a>
          `,
        }
      }
      return {
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<h1>Cabinet de conseil IT ESN en Ile-de-France</h1><a href="mailto:recruteur.idf@example-esn.fr">Recruteur IDF</a>',
      }
    },
  })

  assert.equal(buildWebDiscoveryOffers(config.web_contact_discovery).length, 1)
  assert.equal(fetched.length, 2)
  assert.ok(contacts.some((item) => item.offerKey === 'id:web:recruteurs-idf-esn' && item.email === 'rh-public@example-esn.fr'))
  assert.ok(contacts.some((item) => item.email === 'recruteur.idf@example-esn.fr'))
  assert.equal(contacts.some((item) => item.sourceUrl.includes('linkedin.com')), false)
})

test('contacts web: ignore les pages sans signal ESN IDF', async () => {
  const contacts = await discoverWebRecruiterContacts({
    web_contact_discovery: {
      enabled: true,
      max_results_per_query: 1,
      max_pages_per_query: 1,
      queries: [{ label: 'Recruteurs IDF ESN', query: 'recruteur IDF ESN email recrutement' }],
    },
  }, {
    fetcher: async (url) => {
      if (String(url).includes('duckduckgo')) {
        return {
          ok: true,
          headers: new Map([['content-type', 'text/html']]),
          text: async () => `<a href="/l/?uddg=${encodeURIComponent('https://hors-cible.example.fr/contact')}">Result</a>`,
        }
      }
      return {
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<a href="mailto:contact@hors-cible.example.fr">Contact</a><p>Agence marketing à Lyon.</p>',
      }
    },
  })

  assert.equal(contacts.some((item) => item.email === 'contact@hors-cible.example.fr'), false)
})

test('candidatures: tente une autre adresse apres rejet SMTP 5xx immediat', async () => {
  await withCvEnv(async () => {
    saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour [Intitulé du poste]',
    })

    const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const db = { kind: 'json', path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
    const sent = []
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live', APPLICATION_EMAIL_MAX_CONTACTS_PER_OFFER: '3' },
      mailer: async (message) => {
        sent.push(message)
        if (message.to === 'bad@example.fr') {
          const error = new Error('550 5.1.1 user unknown')
          error.responseCode = 550
          throw error
        }
        return { messageId: `message-${sent.length}` }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'offer:retry', title: 'Product Owner', verdict: 'à candidater', emails: ['bad@example.fr', 'good@example.fr'] }),
      ],
      startedAt: '2026-05-14T07:55:00.000Z',
    })

    assert.equal(summary.sent, 1)
    assert.equal(summary.failed, 0)
    assert.deepEqual(sent.map((message) => message.to), ['bad@example.fr', 'good@example.fr'])
    const contacts = getApplicationContacts(db, 'link:https://example.test/job/1')
    assert.equal(contacts.find((item) => item.email === 'bad@example.fr')?.status, 'invalid')
    assert.equal(contacts.find((item) => item.email === 'good@example.fr')?.status, 'sent_pending_delivery')
  })
})

test('candidatures: respecte le quota quotidien live', async () => {
  await withCvEnv(async () => {
    saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour [Intitulé du poste]',
    })

    const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const db = { kind: 'json', path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
    const sent = []
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live', APPLICATION_EMAIL_DAILY_LIMIT: '1' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: `message-${sent.length}` }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'offer:1', link: 'https://example.test/job/1', verdict: 'à candidater', emails: ['a@example.fr'] }),
        offer({ id: 'offer:2', link: 'https://example.test/job/2', verdict: 'à candidater', emails: ['b@example.fr'] }),
      ],
      startedAt: '2026-05-14T07:55:00.000Z',
    })

    assert.equal(summary.sent, 1)
    assert.equal(summary.skipped, 1)
    assert.equal(sent.length, 1)
    assert.ok(summary.results.some((row) => row.reason === 'daily_limit_reached'))
  })
})

test('rebonds: marque un hard bounce et accepte les envois sans rebond apres grace', async () => {
  await withCvEnv(async () => {
    saveCvUpload({
      originalName: 'CV Adri.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    })
    saveApplicationMailTemplate({
      firstName: 'Adrien',
      lastName: 'Pujol',
      phone: '06 00 00 00 00',
      subjectTemplate: 'Candidature : [Intitulé du poste]',
      bodyTemplate: 'Bonjour [Intitulé du poste]',
    })

    const jsonPath = makeJsonStore({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const db = { kind: 'json', path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-10T08:00:00.000Z'),
      env: {
        APPLICATION_EMAIL_DELIVERY_MODE: 'live',
        APPLICATION_EMAIL_BOUNCE_ADDRESS: 'bounce@example.fr',
      },
      mailer: async () => ({ messageId: 'message-1' }),
      logger: silentLogger(),
      offers: [
        offer({ id: 'offer:bounce', link: 'https://example.test/job/bounce', verdict: 'à candidater', collectedAt: '2026-05-10T07:00:00.000Z', emails: ['bad@example.fr'] }),
      ],
      startedAt: '2026-05-10T07:55:00.000Z',
    })

    const attemptId = summary.results[0].attemptId
    const bounceSummary = await processApplicationBounces({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_GRACE_HOURS: '72' },
      logger: silentLogger(),
      messages: [`Final-Recipient: rfc822; bad@example.fr\nStatus: 5.1.1\nX-Opportunity-Radar-Attempt: ${attemptId}`],
    })

    assert.equal(bounceSummary.hardBounced, 1)
    const contacts = getApplicationContacts(db, 'link:https://example.test/job/bounce')
    assert.equal(contacts[0].status, 'hard_bounced')
  })
})

test('candidatures spontanees: bloque les envois hors fenetre 08h-21h59 Paris', async () => {
  await withCvEnv(async () => {
    setupCvForSpontaneous()
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []

    const summary = await sendDailySpontaneousApplications({
      db,
      now: new Date('2026-05-14T20:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [offer({ id: 'spontaneous:window', company: 'Acme', emails: ['rh@acme.fr'] })],
    })

    assert.equal(summary.sent, 0)
    assert.equal(summary.skipped, 1)
    assert.equal(sent.length, 0)
    assert.equal(summary.results[0].actionType, 'spontaneous_application')
  })
})

test('candidatures spontanees: bloque le mode test sans redirection explicite', async () => {
  await withCvEnv(async () => {
    setupCvForSpontaneous()
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []

    const summary = await sendDailySpontaneousApplications({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'test' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [offer({ id: 'spontaneous:test-mode', company: 'Acme', emails: ['rh@acme.fr'] })],
    })

    assert.equal(summary.sent, 0)
    assert.equal(summary.skipped, 1)
    assert.equal(sent.length, 0)
    assert.equal(summary.results[0].skipReason, 'test_redirect_missing')
  })
})

test('candidatures spontanees: stop apres un succes et logge le type', async () => {
  await withCvEnv(async () => {
    setupCvForSpontaneous()
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []

    const summary = await sendDailySpontaneousApplications({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: `message-${sent.length}` }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'spontaneous:1', company: 'Acme', emails: ['rh@acme.fr'] }),
        offer({ id: 'spontaneous:2', company: 'Beta', link: 'https://example.test/job/2', emails: ['rh@beta.fr'] }),
      ],
    })

    assert.equal(summary.sent, 1)
    assert.equal(sent.length, 1)
    assert.equal(summary.results[0].actionType, 'spontaneous_application')
    assert.equal(summary.results[0].dailyStopReason, 'stop_after_1_success')
    assert.equal(summary.results[0].company, 'Acme')
    assert.equal(summary.results[0].contactEmail, 'rh@acme.fr')
  })
})

test('candidatures spontanees: utilise les contacts ESN globaux', async () => {
  await withCvEnv(async () => {
    setupCvForSpontaneous()
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []

    const summary = await sendDailySpontaneousApplications({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      config: {
        esn_contact_discovery: {
          enabled: true,
          max_pages_per_company: 1,
          companies: [{ name: 'Acme ESN', domain: 'acme-esn.fr', url: 'https://acme-esn.fr/' }],
        },
      },
      contactFetcher: async () => ({
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<a href="mailto:talent@acme-esn.fr">RH</a>',
      }),
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [],
    })

    assert.equal(summary.sent, 1)
    assert.equal(sent[0].to, 'talent@acme-esn.fr')
    assert.equal(summary.results[0].company, 'Acme ESN')
    assert.equal(summary.results[0].offerKey, 'id:esn:acme-esn')
  })
})

test('candidatures spontanees: utilise les contacts web globaux', async () => {
  await withCvEnv(async () => {
    setupCvForSpontaneous()
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []

    const summary = await sendDailySpontaneousApplications({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      config: {
        web_contact_discovery: {
          enabled: true,
          max_results_per_query: 1,
          max_pages_per_query: 1,
          queries: [{ label: 'Recruteurs IDF ESN', query: 'recruteur IDF ESN email recrutement' }],
        },
      },
      contactFetcher: async (url) => {
        if (String(url).includes('duckduckgo')) {
          return {
            ok: true,
            headers: new Map([['content-type', 'text/html']]),
            text: async () => `<a href="/l/?uddg=${encodeURIComponent('https://example-esn.fr/recruteur-idf')}">Result</a>`,
          }
        }
        return {
          ok: true,
          headers: new Map([['content-type', 'text/html']]),
          text: async () => '<h1>ESN en Ile-de-France</h1><p>Recrutement Product Owner et Business Analyst.</p><a href="mailto:recruteur.idf@example-esn.fr">Contact</a>',
        }
      },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [],
    })

    assert.equal(summary.sent, 1)
    assert.equal(sent[0].to, 'recruteur.idf@example-esn.fr')
    assert.equal(summary.results[0].company, 'Recruteurs IDF ESN')
    assert.equal(summary.results[0].offerKey, 'id:web:recruteurs-idf-esn')
  })
})

test('candidatures spontanees: retry apres echec puis stop apres succes', async () => {
  await withCvEnv(async () => {
    setupCvForSpontaneous()
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []

    const summary = await sendDailySpontaneousApplications({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      mailer: async (message) => {
        sent.push(message)
        if (sent.length === 1) throw new Error('SMTP timeout')
        return { messageId: 'message-2' }
      },
      logger: silentLogger(),
      offers: [offer({ id: 'spontaneous:retry', company: 'Acme', emails: ['rh@acme.fr'] })],
    })

    assert.equal(summary.failed, 1)
    assert.equal(summary.sent, 1)
    assert.equal(sent.length, 2)
    assert.deepEqual(summary.results.map((row) => row.attemptOfDay), [1, 2])
    assert.deepEqual(sent.map((message) => message.to), ['rh@acme.fr', 'rh@acme.fr'])
  })
})

test('candidatures spontanees: stop apres 3 echecs', async () => {
  await withCvEnv(async () => {
    setupCvForSpontaneous()
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []

    const summary = await sendDailySpontaneousApplications({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      mailer: async (message) => {
        sent.push(message)
        throw new Error('SMTP down')
      },
      logger: silentLogger(),
      offers: [offer({ id: 'spontaneous:fail', company: 'Acme', emails: ['rh@acme.fr'] })],
    })

    assert.equal(summary.sent, 0)
    assert.equal(summary.failed, 3)
    assert.equal(sent.length, 3)
    assert.equal(summary.results.at(-1).dailyStopReason, 'stop_after_3_failures')
  })
})

test('candidatures spontanees: mail sans URL offre et contenu attendu', () => {
  const message = buildSpontaneousApplicationMessage({
    context: {
      applicationMail: {
        firstName: 'Adrien',
        lastName: 'Pujol',
        phone: '06 00 00 00 00',
      },
    },
  })

  assert.equal(message.subject, 'Candidature spontanée')
  assert.match(message.text, /Product Owner/)
  assert.match(message.text, /Business Analyst/)
  assert.match(message.text, /Chef de projet MOA/)
  assert.equal(/https?:\/\//.test(message.text), false)
  assert.match(message.text, /06 00 00 00 00/)
  assert.match(message.text, /Adrien Pujol/)
})

test('candidatures spontanees: ne renvoie pas a un email deja envoye', async () => {
  await withCvEnv(async () => {
    setupCvForSpontaneous()
    const db = jsonDb({
      sourceChecks: [],
      radarRuns: [],
      offerEmails: [],
      applicationEmailSends: [{
        sentAt: '2026-05-13T08:00:00.000Z',
        actionType: 'spontaneous_application',
        offerKey: 'spontaneous:rh@acme.fr',
        offerId: '',
        offerTitle: '',
        company: 'Acme',
        originalTo: 'rh@acme.fr',
        sentTo: 'rh@acme.fr',
        subject: 'Candidature spontanée',
        messageId: 'old',
        attemptId: 'old',
        contactEmail: 'rh@acme.fr',
        status: 'sent_pending_delivery',
        error: '',
      }],
      applicationContacts: [],
    })
    const sent = []

    const summary = await sendDailySpontaneousApplications({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: { APPLICATION_EMAIL_DELIVERY_MODE: 'live' },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [offer({ id: 'spontaneous:duplicate', company: 'Acme', emails: ['rh@acme.fr'] })],
    })

    assert.equal(summary.sent, 0)
    assert.equal(summary.skipped, 1)
    assert.equal(sent.length, 0)
    assert.equal(summary.results.at(-1).skipReason, 'no_contact_available')
  })
})

test('profils candidats: choisit le profil selon le metier et respecte les exclusions', () => {
  withProfilesEnv((configPath) => {
    const profiles = loadCandidateProfiles({ configPath })

    assert.equal(selectCandidateProfile(offer({ title: 'Business Analyst Assurance' }), profiles).pseudo, 'adri')
    assert.equal(selectCandidateProfile(offer({ title: 'Conseiller funéraire H/F', description: 'Pompes funèbres.' }), profiles).pseudo, 'léna')
    assert.equal(selectCandidateProfile(offer({ title: 'Maître de cérémonie funéraire H/F' }), profiles), null)
  })
})

test('profils candidats: bloque un profil incomplet avant envoi', async () => {
  await withProfilesEnv(async (configPath) => {
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: {
        APPLICATION_EMAIL_DELIVERY_MODE: 'live',
        CANDIDATE_PROFILES_CONFIG: configPath,
        SMTP_USER: 'adri-smtp@example.test',
        SMTP_PASSWORD: 'adri-password',
        SECOND_SMTP_HOST: 'smtp.second.example.test',
        SECOND_SMTP_PORT: '587',
        SECOND_SMTP_SECURE: 'false',
        SECOND_SMTP_USER: 'lena-smtp@example.test',
        SECOND_SMTP_PASSWORD: 'lena-password',
        SECOND_MAIL_FROM: 'Lena <lena@example.test>',
      },
      mailer: async (message) => {
        sent.push(message)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'funeral:missing-cv', title: 'Conseiller funéraire H/F', company: 'Pompes Funèbres Exemple', emails: ['rh@léna.example'] }),
      ],
    })

    assert.equal(summary.sent, 0)
    assert.equal(summary.skipped, 1)
    assert.equal(sent.length, 0)
    assert.match(summary.results[0].reason, /CV introuvable/)
    assert.equal(summary.results[0].profilePseudo, 'léna')
  }, { missingFuneralCv: true })
})

test('profils candidats: envoie avec le CV, le from et le template du profil choisi', async () => {
  await withProfilesEnv(async (configPath) => {
    const db = jsonDb({ sourceChecks: [], radarRuns: [], offerEmails: [], applicationEmailSends: [], applicationContacts: [] })
    const sent = []
    const envs = []
    const summary = await sendDailyApplicationEmails({
      db,
      now: new Date('2026-05-14T08:00:00.000Z'),
      env: {
        APPLICATION_EMAIL_DELIVERY_MODE: 'live',
        CANDIDATE_PROFILES_CONFIG: configPath,
        SMTP_USER: 'adri-smtp@example.test',
        SMTP_PASSWORD: 'adri-password',
        SECOND_SMTP_HOST: 'smtp.second.example.test',
        SECOND_SMTP_PORT: '587',
        SECOND_SMTP_SECURE: 'false',
        SECOND_SMTP_USER: 'lena-smtp@example.test',
        SECOND_SMTP_PASSWORD: 'lena-password',
        SECOND_MAIL_FROM: 'Lena <lena@example.test>',
      },
      mailer: async (message, env) => {
        sent.push(message)
        envs.push(env)
        return { messageId: 'message-1' }
      },
      logger: silentLogger(),
      offers: [
        offer({ id: 'funeral:1', title: 'Assistant funéraire H/F', company: 'Pompes Funèbres Exemple', emails: ['rh@lena.example'] }),
      ],
    })

    assert.equal(summary.sent, 1)
    assert.equal(summary.results[0].profilePseudo, 'léna')
    assert.equal(sent[0].attachments[0].filename, 'CV-lena.pdf')
    assert.equal(envs[0].APPLICATION_FROM, 'Lena <lena@example.test>')
    assert.equal(envs[0].SMTP_HOST, 'smtp.second.example.test')
    assert.equal(envs[0].SMTP_USER, 'lena-smtp@example.test')
    assert.equal(envs[0].SMTP_PASSWORD, 'lena-password')
    assert.match(sent[0].text, /posture sérieuse/)
    assert.match(sent[0].text, /Assistant funéraire H\/F/)
  })
})

test('profils candidats: utilise le CV actif et l identite stockes par profil', () => {
  withCvEnv(() => {
    const uploaded = saveCvUpload({
      pseudo: 'léna',
      originalName: 'CV-ui-léna.pdf',
      buffer: Buffer.from('%PDF ui léna'),
    })
    saveApplicationMailTemplate({
      firstName: 'UI',
      lastName: 'Lena',
      phone: '0600000003',
    }, { pseudo: 'léna' })

    const context = buildApplicationContextFromProfile({
      pseudo: 'léna',
      firstName: 'Config',
      lastName: 'Config',
      phone: '0600000000',
      emailFrom: 'léna@example.test',
      cvPath: '/tmp/cv-config-missing.pdf',
      targetRoles: ['léna'],
      excludedRoles: [],
      dailyQuota: 1,
    })

    assert.equal(context.ready, true)
    assert.equal(context.cvFileName, 'CV-ui-léna.pdf')
    assert.equal(context.cvPath, path.join(uploaded.storageDir, 'CV-ui-léna.pdf'))
    assert.equal(context.applicationMail.firstName, 'UI')
    assert.equal(context.applicationMail.lastName, 'Lena')
    assert.equal(context.applicationMail.phone, '0600000003')
  })
})

test('templates dynamiques: classe les angles PO BA MOA funeraire et transverse', () => {
  assert.equal(classifyApplicationType(offer({ title: 'Product Owner H/F' })).type, 'po')
  assert.equal(classifyApplicationType(offer({ title: 'Business Analyst H/F' })).type, 'ba')
  assert.equal(classifyApplicationType(offer({ title: 'Chef de projet MOA H/F' })).type, 'moa')
  assert.equal(classifyApplicationType(offer({ title: 'Conseiller funéraire H/F' })).type, 'funeral')
  assert.equal(classifyApplicationType(offer({ title: 'Coordinateur projet H/F' })).type, 'transverse')
})

function makeJsonStore(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opportunity-radar-'))
  const jsonPath = path.join(dir, 'store.json')
  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`)
  return jsonPath
}

function jsonDb(data) {
  const jsonPath = makeJsonStore(data)
  return { kind: 'json', path: jsonPath, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
}

function setupCvForSpontaneous() {
  saveCvUpload({
    originalName: 'CV Adri.pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  })
  saveApplicationMailTemplate({
    firstName: 'Adrien',
    lastName: 'Pujol',
    phone: '06 00 00 00 00',
    subjectTemplate: 'Candidature : [Intitulé du poste]',
    bodyTemplate: 'Bonjour [Intitulé du poste]',
  })
}

function nightlySchedule(overrides = {}) {
  return {
    timezone: 'Europe/Paris',
    night_hours: [2, 4, 6],
    retry_interval_hours: 2,
    max_failures_per_day: 3,
    state_path: './data/radar-nightly-state.json',
    ...overrides,
  }
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

function withCvEnv(fn) {
  const previous = {
    CV_STORAGE_DIR: process.env.CV_STORAGE_DIR,
    CV_USER_PSEUDO: process.env.CV_USER_PSEUDO,
    CANDIDATE_PROFILES_CONFIG: process.env.CANDIDATE_PROFILES_CONFIG,
    AUTH_USERNAME: process.env.AUTH_USERNAME,
    OPPORTUNITY_RADAR_PRIVATE_DIR: process.env.OPPORTUNITY_RADAR_PRIVATE_DIR,
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opportunity-radar-cv-'))
  process.env.CV_STORAGE_DIR = path.join(dir, 'cv')
  process.env.CV_USER_PSEUDO = ''
  process.env.CANDIDATE_PROFILES_CONFIG = path.join(dir, 'missing-profiles.json')
  process.env.AUTH_USERNAME = 'Adrien Test'
  delete process.env.OPPORTUNITY_RADAR_PRIVATE_DIR
  const cleanup = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
  try {
    const result = fn()
    if (result && typeof result.then === 'function') return result.finally(cleanup)
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

function withProfilesEnv(fn, { missingFuneralCv = false } = {}) {
  const previous = {
    CANDIDATE_PROFILES_CONFIG: process.env.CANDIDATE_PROFILES_CONFIG,
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opportunity-radar-profiles-'))
  const adriCv = path.join(dir, 'CV-adri.pdf')
  const lenaCv = path.join(dir, 'CV-lena.pdf')
  fs.writeFileSync(adriCv, '%PDF-1.4 adri')
  if (!missingFuneralCv) fs.writeFileSync(lenaCv, '%PDF-1.4 léna')
  const configPath = path.join(dir, 'profiles.json')
  fs.writeFileSync(configPath, `${JSON.stringify({
    profiles: [
      {
        pseudo: 'adri',
        firstName: 'Adrien',
        lastName: 'Adri',
        emailFrom: 'adri@example.test',
        cvPath: adriCv,
        targetRoles: ['product owner', 'business analyst', 'chef de projet moa', 'consultant amoa', 'consultant moa'],
        excludedRoles: [],
        dailyQuota: 2,
      },
      {
        pseudo: 'léna',
        firstName: 'Adrien',
        lastName: 'Lena',
        emailFrom: 'lena@example.test',
        smtpPrefix: 'SECOND',
        cvPath: lenaCv,
        targetRoles: ['conseiller funeraire', 'assistant funeraire', 'funeraire', 'pompes funebres'],
        excludedRoles: ['maitre de ceremonie', 'porteur', 'chauffeur'],
        dailyQuota: 2,
      },
    ],
  }, null, 2)}\n`)
  process.env.CANDIDATE_PROFILES_CONFIG = configPath
  const cleanup = () => {
    if (previous.CANDIDATE_PROFILES_CONFIG === undefined) delete process.env.CANDIDATE_PROFILES_CONFIG
    else process.env.CANDIDATE_PROFILES_CONFIG = previous.CANDIDATE_PROFILES_CONFIG
    fs.rmSync(dir, { recursive: true, force: true })
  }
  try {
    const result = fn(configPath)
    if (result && typeof result.then === 'function') return result.finally(cleanup)
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
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

function silentLogger() {
  return {
    log() {},
    warn() {},
    error() {},
  }
}
