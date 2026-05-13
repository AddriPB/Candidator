export const source = 'france_travail'

export async function fetchOffers(keyword) {
  if (!process.env.FRANCE_TRAVAIL_CLIENT_ID || !process.env.FRANCE_TRAVAIL_CLIENT_SECRET) return []
  const token = await getToken()
  const params = new URLSearchParams({
    motsCles: keyword,
    region: '11',
    range: '0-149',
    sort: '1',
  })
  const res = await fetch(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`France Travail ${keyword}: ${res.status}`)
  const data = await res.json()
  const fetchedAt = new Date().toISOString()
  return (data.resultats || []).map((offer) => ({
    source,
    sourceOfferId: offer.id,
    title: offer.intitule,
    company: offer.entreprise?.nom,
    url: offer.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`,
    location: [offer.lieuTravail?.libelle, offer.lieuTravail?.commune].filter(Boolean).join(' - '),
    contractType: offer.typeContratLibelle || offer.typeContrat,
    salaryMin: null,
    salaryMax: null,
    salaryRaw: offer.salaire?.libelle || '',
    remoteRaw: offer.teletravail || offer.deplacementCode || '',
    description: offer.description || '',
    publishedAt: offer.dateCreation || null,
    fetchedAt,
  }))
}

async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
    scope: `api_offresdemploiv2 o2dsoffre application_${process.env.FRANCE_TRAVAIL_CLIENT_ID}`,
  })
  const res = await fetch('https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`France Travail auth failed: ${res.status}`)
  return (await res.json()).access_token
}
