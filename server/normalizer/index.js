export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function normalizeOffer(offer) {
  const fetchedAt = offer.fetchedAt || new Date().toISOString()
  return {
    source: offer.source,
    sourceOfferId: String(offer.sourceOfferId || offer.url || `${offer.title}-${offer.company}`),
    title: offer.title || 'Sans titre',
    company: offer.company || 'Entreprise non communiquée',
    url: offer.url || '',
    location: offer.location || '',
    contractType: offer.contractType || '',
    salaryMin: toInteger(offer.salaryMin),
    salaryMax: toInteger(offer.salaryMax),
    salaryRaw: offer.salaryRaw || '',
    remoteRaw: offer.remoteRaw || '',
    description: offer.description || '',
    publishedAt: offer.publishedAt || null,
    fetchedAt,
  }
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num) : null
}
