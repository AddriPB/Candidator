export const source = 'adzuna'

export async function fetchOffers(keyword) {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) return []
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID,
    app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: '50',
    what: keyword,
    where: 'Ile-de-France',
    sort_by: 'date',
  })
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/fr/search/1?${params}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Adzuna ${keyword}: ${res.status}`)
  const data = await res.json()
  const fetchedAt = new Date().toISOString()
  return (data.results || []).map((offer) => ({
    source,
    sourceOfferId: String(offer.id),
    title: offer.title,
    company: offer.company?.display_name,
    url: offer.redirect_url,
    location: offer.location?.display_name,
    contractType: offer.contract_type || '',
    salaryMin: offer.salary_min || null,
    salaryMax: offer.salary_max || null,
    salaryRaw: formatSalary(offer.salary_min, offer.salary_max),
    remoteRaw: offer.contract_time || '',
    description: offer.description || '',
    publishedAt: offer.created || null,
    fetchedAt,
  }))
}

function formatSalary(min, max) {
  if (!min && !max) return ''
  const fmt = (value) => `${Math.round(value / 1000)}kEUR`
  if (min && max) return `${fmt(min)} - ${fmt(max)}/an`
  return min ? `à partir de ${fmt(min)}/an` : `jusqu'à ${fmt(max)}/an`
}
