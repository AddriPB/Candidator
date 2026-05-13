export const source = 'careerjet'

export async function fetchOffers(keyword) {
  if (!process.env.CAREERJET_AFFILIATE_ID) return []
  const params = new URLSearchParams({
    keywords: keyword,
    location: 'Ile de France',
    affid: process.env.CAREERJET_AFFILIATE_ID,
    locale_code: 'fr_FR',
    pagesize: '50',
    user_ip: '127.0.0.1',
    user_agent: 'Mozilla/5.0 (compatible; OpportunityRadar/1.0)',
  })
  const res = await fetch(`https://public.api.careerjet.net/search?${params}`, {
    headers: { Referer: 'http://localhost' },
  })
  if (!res.ok) throw new Error(`Careerjet ${keyword}: ${res.status}`)
  const data = await res.json()
  if (data.type === 'ERROR') throw new Error(`Careerjet API: ${data.error || data.message || 'unknown error'}`)
  const fetchedAt = new Date().toISOString()
  return (data.jobs || []).map((offer) => ({
    source,
    sourceOfferId: offer.url || `${offer.title}-${offer.company}-${offer.date}`,
    title: offer.title,
    company: offer.company,
    url: offer.url,
    location: offer.locations,
    contractType: '',
    salaryMin: null,
    salaryMax: null,
    salaryRaw: offer.salary || '',
    remoteRaw: '',
    description: offer.description || '',
    publishedAt: offer.date || null,
    fetchedAt,
  }))
}
