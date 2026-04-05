/**
 * fetch-jobs.js
 * Script Node.js exécuté quotidiennement par GitHub Actions.
 * Récupère les offres d'emploi depuis France Travail et Adzuna,
 * déduplique et écrit dans Firestore.
 *
 * Usage : node scripts/fetch-jobs.js
 * Variables d'environnement requises (GitHub Secrets) :
 *   FIREBASE_SERVICE_ACCOUNT  — JSON du compte de service Firebase (minifié)
 *   FRANCE_TRAVAIL_CLIENT_ID
 *   FRANCE_TRAVAIL_CLIENT_SECRET
 *   ADZUNA_APP_ID
 *   ADZUNA_APP_KEY
 *   VITE_FIREBASE_PROJECT_ID  — project ID Firebase
 */

import { createHash } from 'crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// ── Init Firebase Admin ──────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

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

// ── Lire les paramètres de recherche depuis Firestore ────────────────────────
async function getSearchParams() {
  const snap = await db.collection('config').doc('search_params').get()
  if (snap.exists) {
    return {
      keywords: snap.data().keywords ?? ['Product Owner', 'Business Analyst'],
      location: snap.data().location ?? 'Île-de-France',
    }
  }
  return { keywords: ['Product Owner', 'Business Analyst'], location: 'Île-de-France' }
}

// ── France Travail API ───────────────────────────────────────────────────────
async function getFranceTravailToken() {
  const clientId = process.env.FRANCE_TRAVAIL_CLIENT_ID
  const clientSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'api_offresdemploiv2 o2dsoffre',
  })
  const res = await fetch('https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`France Travail auth failed: ${res.status}`)
  const data = await res.json()
  return data.access_token
}

async function fetchFranceTravail(keyword, token) {
  // Région Île-de-France = code 11
  const params = new URLSearchParams({
    motsCles: keyword,
    region: '11',
    range: '0-149',
    sort: '1',           // Tri par date
  })
  const res = await fetch(
    `https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  )
  if (!res.ok) {
    console.warn(`France Travail fetch failed for "${keyword}": ${res.status}`)
    return []
  }
  const data = await res.json()
  const offres = data.resultats ?? []
  return offres.map((o) => {
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
  const appId = process.env.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: '50',
    what: keyword,
    where: 'Ile-de-France',
    sort_by: 'date',
  })
  const res = await fetch(
    `https://api.adzuna.com/v1/api/jobs/fr/search/1?${params}`,
    { headers: { Accept: 'application/json' } }
  )
  if (!res.ok) {
    console.warn(`Adzuna fetch failed for "${keyword}": ${res.status}`)
    return []
  }
  const data = await res.json()
  const results = data.results ?? []
  return results.map((o) => ({
    title: o.title ?? 'Sans titre',
    company: o.company?.display_name ?? 'Entreprise non communiquée',
    url: o.redirect_url ?? '',
    source: 'adzuna',
    sourceId: String(o.id),
  }))
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Candidator — Fetch Jobs ===')
  const { keywords } = await getSearchParams()
  console.log(`Mots-clés : ${keywords.join(', ')}`)
  console.log('Zone : Île-de-France (région 11)')

  let totalNew = 0

  // France Travail
  let ftToken
  try {
    ftToken = await getFranceTravailToken()
    console.log('France Travail : token obtenu')
  } catch (err) {
    console.error('France Travail auth error:', err.message)
  }

  if (ftToken) {
    for (const keyword of keywords) {
      const offers = await fetchFranceTravail(keyword, ftToken)
      console.log(`France Travail "${keyword}" : ${offers.length} offres récupérées`)
      for (const job of offers) {
        const saved = await saveJob(job)
        if (saved) totalNew++
      }
    }
  }

  // Adzuna
  for (const keyword of keywords) {
    const offers = await fetchAdzuna(keyword)
    console.log(`Adzuna "${keyword}" : ${offers.length} offres récupérées`)
    for (const job of offers) {
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
