export const source = 'jsearch'

export async function fetchOffers(keyword) {
  if (!process.env.RAPIDAPI_KEY) return []
  const params = new URLSearchParams({
    query: `${keyword} Île-de-France CDI`,
    page: '1',
    num_pages: '1',
    date_posted: 'week',
    country: 'fr',
  })
  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: {
      'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`JSearch ${keyword}: ${res.status}`)
  const data = await res.json()
  const fetchedAt = new Date().toISOString()
  return (data.data || []).map((offer) => ({
    source,
    sourceOfferId: offer.job_id,
    title: offer.job_title,
    company: offer.employer_name,
    url: offer.job_apply_link || offer.job_google_link,
    location: offer.job_location,
    contractType: offer.job_employment_type || '',
    salaryMin: offer.job_min_salary || null,
    salaryMax: offer.job_max_salary || null,
    salaryRaw: formatSalary(offer),
    remoteRaw: offer.job_is_remote ? 'remote' : '',
    description: offer.job_description || '',
    publishedAt: offer.job_posted_at_datetime_utc || null,
    fetchedAt,
  }))
}

function formatSalary(offer) {
  const min = offer.job_min_salary
  const max = offer.job_max_salary
  if (!min && !max) return ''
  const currency = offer.job_salary_currency || 'EUR'
  const period = offer.job_salary_period === 'YEAR' ? '/an' : ''
  if (min && max) return `${Math.round(min)}-${Math.round(max)} ${currency}${period}`
  return min ? `à partir de ${Math.round(min)} ${currency}${period}` : `jusqu'à ${Math.round(max)} ${currency}${period}`
}
