const QUERY = 'Product Owner'

export async function checkSources() {
  const checks = await Promise.allSettled([
    checkFranceTravail(),
    checkAdzuna(),
    checkJSearch(),
    checkCareerjet(),
  ])

  return checks.map((check, index) => {
    if (check.status === 'fulfilled') return check.value
    return { source: ['france_travail', 'adzuna', 'jsearch', 'careerjet'][index], ok: false, detail: check.reason.message }
  })
}

async function checkFranceTravail() {
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
  if (!tokenRes.ok) return failed('france_travail', `auth HTTP ${tokenRes.status}`)

  const token = (await tokenRes.json()).access_token
  const params = new URLSearchParams({ motsCles: QUERY, region: '11', range: '0-4' })
  const res = await fetch(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return failed('france_travail', `search HTTP ${res.status}`)
  const data = await res.json()
  return passed('france_travail', `${(data.resultats || []).length} result(s)`)
}

async function checkAdzuna() {
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID,
    app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: '5',
    what: QUERY,
    where: 'Ile-de-France',
  })
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/fr/search/1?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return failed('adzuna', `HTTP ${res.status}`)
  const data = await res.json()
  return passed('adzuna', `${(data.results || []).length} result(s)`)
}

async function checkJSearch() {
  const params = new URLSearchParams({
    query: `${QUERY} Ile-de-France CDI`,
    page: '1',
    num_pages: '1',
    country: 'fr',
  })
  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: {
      'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return failed('jsearch', `HTTP ${res.status}`)
  const data = await res.json()
  return passed('jsearch', `${(data.data || []).length} result(s)`)
}

async function checkCareerjet() {
  const params = new URLSearchParams({
    locale_code: 'fr_FR',
    keywords: QUERY,
    location: 'Ile de France',
    page_size: '5',
    user_ip: '127.0.0.1',
    user_agent: 'OpportunityRadar/0.1',
  })
  const credentials = Buffer.from(`${process.env.CAREERJET_API_KEY}:`).toString('base64')
  const res = await fetch(`https://search.api.careerjet.net/v4/query?${params}`, {
    headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return failed('careerjet', `HTTP ${res.status}`)
  const data = await res.json()
  const count = Array.isArray(data.jobs) ? data.jobs.length : Array.isArray(data.results) ? data.results.length : 0
  return passed('careerjet', `${count} result(s)`)
}

function passed(source, detail) {
  return { source, ok: true, detail }
}

function failed(source, detail) {
  return { source, ok: false, detail }
}
