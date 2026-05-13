import { normalizeOffer } from '../normalizer.js'

export const source = 'adzuna'

export async function fetchAdzunaOffers({ query, collectedAt }) {
  requireEnv(['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'])
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID,
    app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: '50',
    what: query,
    where: 'Ile-de-France',
    sort_by: 'date',
  })
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/fr/search/1?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.results || []).map((item) => normalizeOffer({
    source,
    sourceId: item.id,
    title: item.title,
    company: item.company?.display_name,
    location: item.location?.display_name,
    remote: '',
    contract: item.contract_type || item.contract_time,
    salaryMin: item.salary_min,
    salaryMax: item.salary_max,
    currency: 'EUR',
    publishedAt: item.created,
    link: item.redirect_url,
    description: item.description,
    level: '',
    collectedAt,
    query,
    raw: item,
  }))
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`missing env ${missing.join(', ')}`)
}
