import { normalizeOffer, extractSalaryFromText } from '../normalizer.js'

export const source = 'careerjet'

export async function fetchCareerjetOffers({ query, collectedAt }) {
  requireEnv(['CAREERJET_API_KEY'])
  const params = new URLSearchParams({
    locale_code: 'fr_FR',
    keywords: query,
    location: 'Ile de France',
    page_size: '50',
    user_ip: process.env.CAREERJET_USER_IP || '127.0.0.1',
    user_agent: process.env.CAREERJET_USER_AGENT || 'OpportunityRadar/0.1',
  })
  const credentials = Buffer.from(`${process.env.CAREERJET_API_KEY}:`).toString('base64')
  const res = await fetch(`https://search.api.careerjet.net/v4/query?${params}`, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
      Referer: process.env.CAREERJET_REFERER || 'https://addripb.github.io/Opportunity-Radar/',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const jobs = Array.isArray(data.jobs) ? data.jobs : Array.isArray(data.results) ? data.results : []
  return jobs.map((item) => {
    const salary = extractSalaryFromText([item.salary, item.description].filter(Boolean).join(' '))
    return normalizeOffer({
      source,
      sourceId: item.id || item.url,
      title: item.title,
      company: item.company,
      location: item.locations || item.location,
      remote: '',
      contract: item.contract_type || '',
      salaryMin: salary.min,
      salaryMax: salary.max,
      currency: salary.currency,
      publishedAt: item.date,
      link: item.url,
      description: item.description,
      level: '',
      collectedAt,
      query,
      raw: item,
    })
  })
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`missing env ${missing.join(', ')}`)
}
