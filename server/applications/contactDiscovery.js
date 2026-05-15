const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const MAILTO_PATTERN = /mailto:([^"' <>)?]+)/gi
const GENERIC_RECRUITING_LOCALS = ['recrutement', 'jobs', 'talent', 'rh', 'careers']
const ESN_CONTACT_LOCALS = [
  ...GENERIC_RECRUITING_LOCALS,
  'recruteurs',
  'recrutement-france',
  'recrutement.paris',
  'business',
  'commercial',
  'commerce',
  'sales',
  'contact',
]
const ESN_DISCOVERY_PATHS = [
  '',
  '/contact',
  '/nous-contacter',
  '/recrutement',
  '/carrieres',
  '/carriere',
  '/careers',
  '/jobs',
]
const DEFAULT_WEB_SEARCH_URL_TEMPLATE = 'https://html.duckduckgo.com/html/?q={query}'
const TRUSTED_STATUSES = new Set(['candidate', 'soft_bounced', 'retry_scheduled'])

const EXCLUDED_CONTACT_DOMAINS = [
  'adzuna.',
  'careerjet.',
  'francetravail.fr',
  'pole-emploi.fr',
  'hellowork.',
  'indeed.',
  'linkedin.',
  'welcome',
  'free-work.',
  'talent.com',
  'ziprecruiter.',
  'trabajo.',
  'jobijoba.',
  'jobrapido.',
  'meteojob.',
  'google.',
  'bing.',
  'duckduckgo.',
]

const EXCLUDED_SEARCH_RESULT_DOMAINS = [
  ...EXCLUDED_CONTACT_DOMAINS,
  'qwant.',
  'ecosia.',
  'yahoo.',
]

const ESN_RELEVANCE_PATTERN = /\b(esn|ssii|cabinet de conseil|conseil en technologie|conseil it|services numeriques|services numériques|transformation digitale|amoa|moa|product owner|business analyst)\b/i
const IDF_RELEVANCE_PATTERN = /\b(idf|ile[- ]de[- ]france|île[- ]de[- ]france|paris|la defense|la défense|neuilly|boulogne|issy|levallois|puteaux|nanterre|courbevoie)\b/i
const RECRUITER_RELEVANCE_PATTERN = /\b(recrut\w*|rh|talent|carrieres|carrières|commercial|business|sales|contact)\b/i

export async function discoverContactsForOffer(offer, {
  offerKey = '',
  env = process.env,
  fetcher = fetch,
  fetchPages = true,
  maxPages = 4,
  genericLocals = GENERIC_RECRUITING_LOCALS,
  now = new Date(),
} = {}) {
  const candidates = []
  const key = offerKey || String(offer.id || offer.link || '')

  addEmails(candidates, extractEmails(offer.emails), {
    offerKey: key,
    method: 'raw_offer',
    sourceUrl: offer.link || '',
    confidence: 100,
  })
  addEmails(candidates, extractEmails([offer.raw, offer.description, offer.link]), {
    offerKey: key,
    method: 'raw_offer',
    sourceUrl: offer.link || '',
    confidence: 90,
  })

  const sourceUrls = collectSourceUrls(offer).slice(0, maxPages)
  if (fetchPages) {
    for (const sourceUrl of sourceUrls) {
      const html = await fetchPublicPage(sourceUrl, fetcher)
      if (!html) continue
      addEmails(candidates, extractMailtoEmails(html), {
        offerKey: key,
        method: 'apply_page',
        sourceUrl,
        confidence: 95,
      })
      addEmails(candidates, extractEmails(html), {
        offerKey: key,
        method: looksLikeCareerPage(sourceUrl, html) ? 'recruiter_public' : 'apply_page',
        sourceUrl,
        confidence: looksLikeCareerPage(sourceUrl, html) ? 85 : 75,
      })
    }
  }

  const domain = bestCompanyDomain(offer, sourceUrls)
  if (domain) {
    for (const local of genericLocals) {
      candidates.push(contact({
        offerKey: key,
        email: `${local}@${domain}`,
        method: 'generic_domain',
        sourceUrl: domainSourceUrl(offer, sourceUrls, domain),
        confidence: 45,
        now,
      }))
    }

    if (String(env.APPLICATION_EMAIL_INFERRED_ENABLED || 'true').toLowerCase() === 'true') {
      for (const local of inferRecruiterLocals(offer)) {
        candidates.push(contact({
          offerKey: key,
          email: `${local}@${domain}`,
          method: 'inferred',
          sourceUrl: domainSourceUrl(offer, sourceUrls, domain),
          confidence: 35,
          now,
        }))
      }
    }
  }

  return dedupeContacts(candidates)
    .filter((item) => item.offerKey && isValidContactEmail(item.email))
    .sort(compareContacts)
}

export async function discoverEsnRecruiterContacts(config = {}, {
  env = process.env,
  fetcher = fetch,
  fetchPages = true,
  now = new Date(),
} = {}) {
  const discovery = normalizeEsnContactDiscoveryConfig(config.esn_contact_discovery)
  if (!discovery.enabled) return []

  const contacts = []
  for (const offer of buildEsnDiscoveryOffers(discovery)) {
    contacts.push(...await discoverContactsForOffer(offer, {
      offerKey: applicationEsnOfferKey(offer.company),
      env,
      fetcher,
      fetchPages,
      maxPages: discovery.max_pages_per_company,
      genericLocals: ESN_CONTACT_LOCALS,
      now,
    }))
  }
  return dedupeContacts(contacts).sort(compareContacts)
}

export function buildEsnDiscoveryOffers(discovery = {}) {
  return normalizeEsnContactDiscoveryConfig(discovery).companies.map((company) => {
    const url = normalizeCompanyUrl(company.url || company.domain)
    const domain = domainFromUrl(url)
    const id = esnContactOfferId(company.name)
    return {
      id,
      source: 'esn_contact_discovery',
      sourceId: id,
      title: `Contacts RH et commerciaux ESN - ${company.name}`,
      company: company.name,
      link: '',
      description: 'Découverte globale de recruteurs RH et commerciaux en ESN.',
      emails: [],
      raw: {
        employer_website: url,
        discovery_urls: buildDiscoveryUrls(url, company.paths || ESN_DISCOVERY_PATHS),
        company_domain: domain,
      },
    }
  })
}

export async function discoverWebRecruiterContacts(config = {}, {
  fetcher = fetch,
  fetchPages = true,
  now = new Date(),
} = {}) {
  const discovery = normalizeWebContactDiscoveryConfig(config.web_contact_discovery)
  if (!discovery.enabled) return []

  const contacts = []
  for (const query of discovery.queries) {
    const offerKey = applicationWebOfferKey(query.label)
    const searchUrl = discovery.search_url_template.replace('{query}', encodeURIComponent(query.text))
    const searchHtml = await fetchPublicPage(searchUrl, fetcher)
    const searchContext = `${query.text} ${searchHtml}`

    if (looksLikeEsnIdfRecruiterPage(searchContext)) {
      addEmails(contacts, extractMailtoEmails(searchHtml), {
        offerKey,
        method: 'web_search_result',
        sourceUrl: searchUrl,
        confidence: 92,
        now,
      })
      addEmails(contacts, extractEmails(searchHtml), {
        offerKey,
        method: 'web_search_result',
        sourceUrl: searchUrl,
        confidence: 88,
        now,
      })
    }

    if (!fetchPages) continue
    const resultUrls = extractSearchResultUrls(searchHtml, query.text).slice(0, discovery.max_results_per_query)
    for (const resultUrl of resultUrls.slice(0, discovery.max_pages_per_query)) {
      const html = await fetchPublicPage(resultUrl, fetcher)
      if (!html) continue
      if (!looksLikeEsnIdfRecruiterPage(`${resultUrl} ${html}`)) continue
      addEmails(contacts, extractMailtoEmails(html), {
        offerKey,
        method: 'web_public_page',
        sourceUrl: resultUrl,
        confidence: 90,
        now,
      })
      addEmails(contacts, extractEmails(html), {
        offerKey,
        method: 'web_public_page',
        sourceUrl: resultUrl,
        confidence: 82,
        now,
      })
    }
  }

  return dedupeContacts(contacts).sort(compareContacts)
}

export function buildWebDiscoveryOffers(discovery = {}) {
  return normalizeWebContactDiscoveryConfig(discovery).queries.map((query) => {
    const id = webContactOfferId(query.label)
    return {
      id,
      source: 'web_contact_discovery',
      sourceId: id,
      title: `Contacts recruteurs web - ${query.label}`,
      company: query.label,
      link: '',
      description: `Découverte web publique: ${query.text}`,
      emails: [],
      raw: {},
    }
  })
}

export function chooseNextContact({ contacts, sends = [], now = new Date(), env = process.env } = {}) {
  const maxContacts = positiveInteger(env.APPLICATION_EMAIL_MAX_CONTACTS_PER_OFFER, 3)
  const perOfferDailyLimit = positiveInteger(env.APPLICATION_EMAIL_PER_OFFER_DAILY_LIMIT, 1)
  const dayStart = startOfUtcDay(now).toISOString()
  const attemptsToday = sends.filter((row) => row.sentAt >= dayStart && isLiveAttempt(row)).length
  if (attemptsToday >= perOfferDailyLimit) return null

  const attemptedEmails = new Set(sends.map((row) => normalizeEmail(row.contactEmail || row.originalTo || row.sentTo)).filter(Boolean))
  const hardBlocked = new Set(
    contacts
      .filter((row) => ['invalid', 'hard_bounced', 'opt_out', 'complaint'].includes(row.status))
      .map((row) => row.email),
  )
  const ordered = contacts
    .filter((row) => TRUSTED_STATUSES.has(row.status || 'candidate'))
    .filter((row) => !hardBlocked.has(row.email))
    .sort(compareContacts)

  let uniqueAttempted = 0
  for (const email of attemptedEmails) {
    if (ordered.some((row) => row.email === email)) uniqueAttempted += 1
  }
  if (uniqueAttempted >= maxContacts) return null

  return ordered.find((row) => !attemptedEmails.has(row.email)) || null
}

export function extractEmails(values) {
  const text = flattenValues(values).join(' ')
  return normalizeEmailMatches(text.match(EMAIL_PATTERN) || [])
}

export function extractMailtoEmails(html) {
  const matches = []
  for (const match of String(html || '').matchAll(MAILTO_PATTERN)) {
    matches.push(decodeURIComponent(String(match[1] || '').split('?')[0]))
  }
  return normalizeEmailMatches(matches)
}

export function inferRecruiterLocals(offer) {
  const names = extractRecruiterNames(offer)
  const locals = []
  for (const name of names) {
    const parts = normalizeNameParts(name)
    if (parts.length < 2) continue
    const first = parts[0]
    const last = parts.at(-1)
    locals.push(`${first}.${last}`, `${first[0]}.${last}`, `${first}${last}`)
  }
  return Array.from(new Set(locals))
}

export function parseDeliveryStatus(text) {
  const value = String(text || '')
  const attemptMatch = value.match(/bounce\+([A-Za-z0-9._:-]+)/) || value.match(/X-Opportunity-Radar-Attempt:\s*([^\s]+)/i)
  const emailMatch = value.match(/(?:Final-Recipient|Original-Recipient):\s*rfc822;\s*([^\s]+)/i) || value.match(EMAIL_PATTERN)
  const statusMatch = value.match(/Status:\s*([245]\.\d+\.\d+)/i) || value.match(/\b([245]\.\d+\.\d+)\b/)
  const diagnosticMatch = value.match(/Diagnostic-Code:\s*([^\n]+)/i)
  const statusCode = statusMatch?.[1] || ''
  return {
    attemptId: attemptMatch?.[1] || '',
    email: normalizeEmail(emailMatch?.[1] || ''),
    statusCode,
    kind: statusCode.startsWith('5.') ? 'hard' : statusCode.startsWith('4.') ? 'soft' : '',
    reason: diagnosticMatch?.[1]?.trim() || statusCode || 'delivery_status_notification',
  }
}

function addEmails(output, emails, options) {
  for (const email of emails) {
    output.push(contact({ ...options, email }))
  }
}

function contact({ offerKey, email, method, sourceUrl = '', confidence = 0, status = 'candidate', now = new Date() }) {
  return {
    offerKey,
    email: normalizeEmail(email),
    method,
    sourceUrl,
    confidence,
    status,
    lastAttemptAt: '',
    bounceReason: '',
    attempts: 0,
    updatedAt: now.toISOString(),
  }
}

function collectSourceUrls(offer) {
  const raw = offer.raw || {}
  const values = [
    offer.link,
    ...(Array.isArray(raw.discovery_urls) ? raw.discovery_urls : []),
    raw.urlPostulation,
    raw.origineOffre?.urlOrigine,
    raw.contact?.urlPostulation,
    raw.contact?.coordonnees1,
    raw.contact?.coordonnees2,
    raw.employer_website,
    raw.url,
    ...(Array.isArray(raw.apply_options) ? raw.apply_options.map((item) => item.apply_link) : []),
  ]
  return Array.from(new Set(values.flatMap(extractUrls))).filter((url) => /^https?:\/\//i.test(url))
}

async function fetchPublicPage(url, fetcher) {
  try {
    const response = await fetcher(url, {
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'OpportunityRadar/0.1 contact-discovery',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return ''
    const contentType = response.headers?.get?.('content-type') || ''
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) return ''
    return (await response.text()).slice(0, 1_500_000)
  } catch {
    return ''
  }
}

function bestCompanyDomain(offer, urls) {
  const raw = offer.raw || {}
  const candidates = [
    raw.employer_website,
    raw.entreprise?.url,
    raw.company_website,
    ...urls,
  ].flatMap(extractUrls)

  for (const url of candidates) {
    const domain = domainFromUrl(url)
    if (domain && !isExcludedContactDomain(domain)) return domain
  }
  return ''
}

function domainSourceUrl(offer, urls, domain) {
  return [offer.raw?.employer_website, offer.raw?.entreprise?.url, ...urls]
    .find((url) => domainFromUrl(url) === domain) || ''
}

function domainFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return hostname || ''
  } catch {
    return ''
  }
}

function normalizeEsnContactDiscoveryConfig(discovery = {}) {
  const companies = Array.isArray(discovery?.companies)
    ? discovery.companies
      .map(normalizeEsnCompany)
      .filter((company) => company.name && (company.domain || company.url))
    : []

  return {
    enabled: discovery?.enabled === true,
    max_pages_per_company: positiveInteger(discovery?.max_pages_per_company, 6),
    companies,
  }
}

function normalizeWebContactDiscoveryConfig(discovery = {}) {
  const queries = Array.isArray(discovery?.queries)
    ? discovery.queries
      .map(normalizeWebQuery)
      .filter((query) => query.text && query.label)
    : []

  return {
    enabled: discovery?.enabled === true,
    search_url_template: String(discovery?.search_url_template || DEFAULT_WEB_SEARCH_URL_TEMPLATE),
    max_results_per_query: positiveInteger(discovery?.max_results_per_query, 5),
    max_pages_per_query: positiveInteger(discovery?.max_pages_per_query, 3),
    queries,
  }
}

function normalizeWebQuery(query = {}) {
  if (typeof query === 'string') return { label: query, text: query }
  const text = String(query.query || query.text || '').trim()
  return {
    label: String(query.label || query.company || text || '').trim(),
    text,
  }
}

function normalizeEsnCompany(company = {}) {
  if (typeof company === 'string') {
    return { name: company, domain: company, url: normalizeCompanyUrl(company), paths: ESN_DISCOVERY_PATHS }
  }
  return {
    name: String(company.name || company.domain || company.url || '').trim(),
    domain: String(company.domain || '').trim(),
    url: normalizeCompanyUrl(company.url || company.domain || ''),
    paths: Array.isArray(company.paths) && company.paths.length ? company.paths : ESN_DISCOVERY_PATHS,
  }
}

function normalizeCompanyUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  return `https://${text}`
}

function buildDiscoveryUrls(baseUrl, paths) {
  const urls = []
  for (const path of paths) {
    try {
      urls.push(new URL(path || '/', baseUrl).toString())
    } catch {
      // ignore invalid seed urls
    }
  }
  return Array.from(new Set(urls))
}

function applicationEsnOfferKey(companyName) {
  return `id:${esnContactOfferId(companyName)}`
}

function esnContactOfferId(companyName) {
  return `esn:${slugify(companyName)}`
}

function applicationWebOfferKey(label) {
  return `id:${webContactOfferId(label)}`
}

function webContactOfferId(label) {
  return `web:${slugify(label)}`
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}

function isExcludedContactDomain(domain) {
  return EXCLUDED_CONTACT_DOMAINS.some((item) => domain.includes(item))
}

function extractRecruiterNames(offer) {
  const values = [
    offer.raw?.contact?.nom,
    offer.raw?.contact?.coordonnees1,
    offer.raw?.contact?.coordonnees2,
    offer.raw?.job_publisher,
  ].filter(Boolean)
  const names = []
  for (const value of values) {
    const text = String(value)
    const match = text.match(/\b(?:M\.|M|Mme|Madame|Monsieur)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ' -]{2,80})/)
    if (match) names.push(match[1])
  }
  return names
}

function looksLikeCareerPage(url, html) {
  const text = `${url} ${String(html || '').slice(0, 20000)}`.toLowerCase()
  return /(recrut|career|carriere|carrière|talent|join|emploi|job)/.test(text)
}

function looksLikeEsnIdfRecruiterPage(value) {
  const text = String(value || '').slice(0, 30000)
  return ESN_RELEVANCE_PATTERN.test(text)
    && IDF_RELEVANCE_PATTERN.test(text)
    && RECRUITER_RELEVANCE_PATTERN.test(text)
}

function extractUrls(value) {
  const text = String(value || '')
  return text.match(/https?:\/\/[^\s"'<>]+/gi) || []
}

function extractSearchResultUrls(html, queryText = '') {
  const urls = []
  const text = String(html || '')
  for (const match of text.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = normalizeSearchResultUrl(match[1], queryText)
    if (url) urls.push(url)
  }
  for (const url of extractUrls(text)) {
    const normalized = normalizeSearchResultUrl(url, queryText)
    if (normalized) urls.push(normalized)
  }
  return Array.from(new Set(urls))
}

function normalizeSearchResultUrl(value, queryText = '') {
  const href = decodeHtmlEntities(String(value || '').trim())
  if (!href) return ''
  try {
    const parsed = new URL(href, 'https://duckduckgo.com')
    const target = parsed.searchParams.get('uddg') || parsed.searchParams.get('u') || parsed.toString()
    const result = new URL(decodeURIComponent(target))
    result.hash = ''
    const domain = result.hostname.toLowerCase().replace(/^www\./, '')
    if (!/^https?:$/i.test(result.protocol)) return ''
    if (!domain || EXCLUDED_SEARCH_RESULT_DOMAINS.some((item) => domain.includes(item))) return ''
    return result.toString().replace(/[),.;:]+$/g, '')
  } catch {
    return ''
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function normalizeEmailMatches(matches) {
  return Array.from(new Set(matches.map(normalizeEmail).filter(isValidContactEmail))).sort()
}

export function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .replace(/[),.;:"'<>]+$/g, '')
}

export function isValidContactEmail(email) {
  if (!email || !email.includes('@') || email.length > 254) return false
  const [local, domain] = email.split('@')
  if (!local || !domain || !domain.includes('.')) return false
  if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|ico|pdf)$/i.test(domain)) return false
  if (/(example\.com|example\.test|email\.com|domain|your\.|votre\.nom|prenom\.nom|john\.doe|no-reply|noreply)/i.test(email)) return false
  return true
}

function dedupeContacts(contacts) {
  const byEmail = new Map()
  for (const item of contacts) {
    if (!isValidContactEmail(item.email)) continue
    const existing = byEmail.get(item.email)
    if (!existing || compareContacts(item, existing) < 0) byEmail.set(item.email, item)
  }
  return Array.from(byEmail.values())
}

function compareContacts(a, b) {
  return Number(b.confidence || 0) - Number(a.confidence || 0)
    || methodRank(a.method) - methodRank(b.method)
    || String(a.email).localeCompare(String(b.email))
}

function methodRank(method) {
  return ['raw_offer', 'apply_page', 'recruiter_public', 'web_search_result', 'web_public_page', 'generic_domain', 'inferred'].indexOf(method) + 1 || 99
}

function normalizeNameParts(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z' -]/g, ' ')
    .split(/\s+/)
    .map((part) => part.toLowerCase().replace(/[^a-z]/g, ''))
    .filter((part) => part.length > 1 && !['madame', 'monsieur', 'mme'].includes(part))
}

function flattenValues(value, output = []) {
  if (value === null || value === undefined) return output
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value))
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenValues(item, output)
    return output
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) flattenValues(item, output)
  }
  return output
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function isLiveAttempt(row) {
  return ['sent_pending_delivery', 'hard_bounced', 'soft_bounced', 'retry_scheduled', 'delivered_or_no_bounce_after_grace_period'].includes(row.status)
}
