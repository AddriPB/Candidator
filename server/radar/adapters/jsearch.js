import { normalizeOffer } from '../normalizer.js'

export const source = 'jsearch'

export async function fetchJSearchOffers({ query, collectedAt }) {
  requireEnv(['RAPIDAPI_KEY'])
  const params = new URLSearchParams({
    query: `${query} Ile-de-France CDI`,
    page: '1',
    num_pages: '1',
    country: 'fr',
    date_posted: 'all',
  })
  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: {
      'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.data || []).map((item) => normalizeOffer({
    source,
    sourceId: item.job_id,
    title: item.job_title,
    company: item.employer_name,
    location: [item.job_city, item.job_state, item.job_country].filter(Boolean).join(', '),
    remote: item.job_is_remote ? 'full remote' : '',
    contract: item.job_employment_type,
    salaryMin: item.job_min_salary,
    salaryMax: item.job_max_salary,
    currency: item.job_salary_currency || '',
    publishedAt: item.job_posted_at_datetime_utc,
    link: item.job_apply_link || item.job_google_link,
    description: item.job_description,
    level: item.job_required_experience?.required_experience_in_months ? `${item.job_required_experience.required_experience_in_months} mois` : '',
    collectedAt,
    query,
    raw: item,
  }))
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`missing env ${missing.join(', ')}`)
}
