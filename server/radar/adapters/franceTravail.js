import { normalizeOffer, extractSalaryFromText } from '../normalizer.js'

export const source = 'france_travail'

export async function fetchFranceTravailOffers({ query, collectedAt }) {
  requireEnv(['FRANCE_TRAVAIL_CLIENT_ID', 'FRANCE_TRAVAIL_CLIENT_SECRET'])
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
    scope: `api_offresdemploiv2 o2dsoffre application_${process.env.FRANCE_TRAVAIL_CLIENT_ID}`,
  })
  const tokenRes = await fetch('https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  })
  if (!tokenRes.ok) throw new Error(`auth HTTP ${tokenRes.status}`)

  const token = (await tokenRes.json()).access_token
  const params = new URLSearchParams({ motsCles: query, region: '11', range: '0-49' })
  const res = await fetch(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`search HTTP ${res.status}`)

  const data = await res.json()
  return (data.resultats || []).map((item) => {
    const salary = salaryFromFranceTravail(item)
    return normalizeOffer({
      source,
      sourceId: item.id,
      title: item.intitule,
      company: item.entreprise?.nom,
      location: item.lieuTravail?.libelle,
      remote: item.teletravail,
      contract: item.typeContrat,
      salaryMin: salary.min,
      salaryMax: salary.max,
      currency: salary.currency,
      publishedAt: item.dateCreation,
      link: item.origineOffre?.urlOrigine || item.url,
      description: item.description,
      level: item.experienceLibelle,
      collectedAt,
      query,
      raw: item,
    })
  })
}

function salaryFromFranceTravail(item) {
  const salaire = item.salaire || {}
  if (salaire.libelle) return extractSalaryFromText(salaire.libelle)
  return { min: null, max: null, currency: '' }
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`missing env ${missing.join(', ')}`)
}
