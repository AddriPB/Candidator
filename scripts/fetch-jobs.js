/**
 * fetch-jobs.js
 * Script Node.js exécuté quotidiennement par GitHub Actions.
 * Sources : France Travail, Adzuna, JSearch (LinkedIn/Indeed), Careerjet
 * Keywords : lus depuis chaque document /users/ dans Firestore (par utilisateur)
 * Filtre : seuls les titres correspondant aux rôles PO/PM/BA sont conservés
 *
 * Secrets GitHub requis :
 *   FIREBASE_SERVICE_ACCOUNT
 *   FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET
 *   ADZUNA_APP_ID / ADZUNA_APP_KEY
 *   RAPIDAPI_KEY
 *   CAREERJET_AFFILIATE_ID
 */

import { createHash } from 'crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// ── Init Firebase Admin ──────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// ── Filtre de titre ──────────────────────────────────────────────────────────
const TITLE_FILTERS = [
  /\bproduct\s*owner\b/i,
  /\bP\.?O\.?\b/i,
  /\bproduct\s*manager\b/i,
  /\bP\.?M\.?\b/i,
  /\bbusiness\s*analyst\b/i,
  /\bB\.?A\.?\b/i,
]

function matchesRoleFilter(title) {
  return TITLE_FILTERS.some((re) => re.test(title))
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeJobId(source, sourceId) {
  return createHash('sha1').update(`${source}_${sourceId}`).digest('hex').slice(0, 20)
}

async function jobExists(jobId) {
  const snap = await db.collection('jobs').doc(jobId).get()
  return snap.exists
}

async function saveJob(job) {
  const jobId = makeJobId(job.source, job.sourceId)
  if (await jobExists(jobId)) return false
  await db.collection('jobs').doc(jobId).set({
    ...job,
    addedAt: Timestamp.now(),
  })
  return true
}

// ── Lire les keywords depuis tous les docs /users/ ───────────────────────────
async function getAllUserKeywords() {
  const snap = await db.collection('users').get()
  const keywordSet = new Set()
  for (const userDoc of snap.docs) {
    for (const kw of (userDoc.data().searchKeywords ?? [])) {
      if (kw.trim()) keywordSet.add(kw.trim())
    }
  }
  // Fallback si aucun utilisateur n'a configuré de keywords
  if (keywordSet.size === 0) {
    console.log('Aucun keyword configuré — utilisation des valeurs par défaut')
    return ['Product Owner', 'Business Analyst', 'Product Manager']
  }
  return [...keywordSet]
}

// ── France Travail API ───────────────────────────────────────────────────────
async function getFranceTravailToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
    scope: 'api_offresdemploiv2 o2dsoffre',
  })
  const res = await fetch(
    'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
  )
  if (!res.ok) throw new Error(`France Travail auth failed: ${res.status}`)
  return (await res.json()).access_token
}

async function fetchFranceTravail(keyword, token) {
  const params = new URLSearchParams({
    motsCles: keyword,
    region: '11', // Île-de-France
    range: '0-149',
    sort: '1',
  })
  const res = await fetch(
    `https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  )
  if (!res.ok) { console.warn(`France Travail "${keyword}": ${res.status}`); return [] }
  const data = await res.json()
  return (data.resultats ?? []).map((o) => {
    const contact = o.contact ?? {}
    const job = {
      title: o.intitule ?? 'Sans titre',
      company: o.entreprise?.nom ?? 'Entreprise non communiquée',
      url: o.origineOffre?.urlOrigine ?? `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
      source: 'france_travail',
      sourceId: o.id,
    }
    const contactName = [contact.prenom, contact.nom].filter(Boolean).join(' ')
    if (contactName) job.contactName = contactName
    if (contact.telephone) job.contactPhone = contact.telephone
    return job
  })
}

// ── Adzuna API ───────────────────────────────────────────────────────────────
async function fetchAdzuna(keyword) {
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID,
    app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: '50',
    what: keyword,
    where: 'Ile-de-France',
    sort_by: 'date',
  })
  const res = await fetch(
    `https://api.adzuna.com/v1/api/jobs/fr/search/1?${params}`,
    { headers: { Accept: 'application/json' } }
  )
  if (!res.ok) { console.warn(`Adzuna "${keyword}": ${res.status}`); return [] }
  const data = await res.json()
  return (data.results ?? []).map((o) => ({
    title: o.title ?? 'Sans titre',
    company: o.company?.display_name ?? 'Entreprise non communiquée',
    url: o.redirect_url ?? '',
    source: 'adzuna',
    sourceId: String(o.id),
  }))
}

// ── JSearch API (LinkedIn + Indeed + Glassdoor via RapidAPI) ─────────────────
async function fetchJSearch(keyword) {
  const params = new URLSearchParams({
    query: `${keyword} Île-de-France`,
    page: '1',
    num_pages: '2',
    date_posted: 'week',
    country: 'fr',
  })
  const res = await fetch(
    `https://jsearch.p.rapidapi.com/search?${params}`,
    {
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        Accept: 'application/json',
      },
    }
  )
  if (!res.ok) { console.warn(`JSearch "${keyword}": ${res.status}`); return [] }
  const data = await res.json()
  return (data.data ?? []).map((o) => ({
    title: o.job_title ?? 'Sans titre',
    company: o.employer_name ?? 'Entreprise non communiquée',
    url: o.job_apply_link ?? '',
    source: 'jsearch',
    sourceId: o.job_id,
  }))
}

// ── Careerjet API (HelloWork, RegionsJob, Cadremploi…) ───────────────────────
async function fetchCareerjet(keyword) {
  const params = new URLSearchParams({
    keywords: keyword,
    location: 'Ile de France',
    affid: process.env.CAREERJET_AFFILIATE_ID,
    locale_code: 'fr_FR',
    pagesize: '99',
    user_ip: '1.0.0.1',
    user_agent: 'Mozilla/5.0 (compatible; Candidator/1.0)',
  })
  // Note : l'API publique Careerjet utilise HTTP (pas HTTPS)
  const res = await fetch(`http://public.api.careerjet.net/search?${params}`)
  if (!res.ok) { console.warn(`Careerjet "${keyword}": ${res.status}`); return [] }
  const data = await res.json()
  return (data.jobs ?? []).map((o) => ({
    title: o.title ?? 'Sans titre',
    company: o.company ?? 'Entreprise non communiquée',
    url: o.url ?? '',
    source: 'careerjet',
    sourceId: o.url, // Careerjet n'expose pas d'ID stable — URL utilisée
  }))
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Candidator — Fetch Jobs ===')
  const keywords = await getAllUserKeywords()
  console.log(`Mots-clés : ${keywords.join(', ')}`)
  console.log('Zone : Île-de-France')

  let totalNew = 0

  // Token France Travail (partagé pour tous les keywords)
  let ftToken
  try {
    ftToken = await getFranceTravailToken()
    console.log('France Travail : token obtenu ✓')
  } catch (err) {
    console.error('France Travail auth error:', err.message)
  }

  for (const keyword of keywords) {
    console.log(`\n--- "${keyword}" ---`)
    const all = []

    if (ftToken) all.push(...await fetchFranceTravail(keyword, ftToken))
    all.push(...await fetchAdzuna(keyword))
    all.push(...await fetchJSearch(keyword))
    all.push(...await fetchCareerjet(keyword))

    const filtered = all.filter((job) => matchesRoleFilter(job.title))
    console.log(`${all.length} offres brutes → ${filtered.length} après filtre titre`)

    for (const job of filtered) {
      const saved = await saveJob(job)
      if (saved) totalNew++
    }
  }

  console.log(`\n✓ ${totalNew} nouvelle(s) offre(s) ajoutée(s) dans Firestore.`)
}

main().catch((err) => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
