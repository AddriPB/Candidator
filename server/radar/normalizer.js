import { stableHash } from './hash.js'
import { compact } from './text.js'

export function normalizeOffer(input) {
  const source = compact(input.source)
  const sourceId = compact(input.sourceId)
  const title = compact(input.title)
  const company = compact(input.company)
  const location = compact(input.location)
  const link = compact(input.link)
  const description = compact(input.description)
  const emails = extractEmailsFromOffer(input)
  const collectedAt = input.collectedAt || new Date().toISOString()
  const fallbackKey = [title, company, location, source, description.slice(0, 180)].join('|')
  const id = sourceId ? `${source}:${sourceId}` : `${source}:${stableHash(link || fallbackKey)}`

  return {
    id,
    sourceId: sourceId || null,
    source,
    title,
    company: company || 'Non renseigné',
    location,
    remote: compact(input.remote),
    contract: compact(input.contract),
    salaryMin: toNumberOrNull(input.salaryMin),
    salaryMax: toNumberOrNull(input.salaryMax),
    currency: compact(input.currency),
    publishedAt: compact(input.publishedAt),
    link,
    description,
    emails,
    hasEmail: emails.length > 0,
    level: compact(input.level),
    collectedAt,
    query: compact(input.query),
    raw: input.raw || null,
  }
}

export function extractEmailsFromOffer(input) {
  const values = [
    input.title,
    input.company,
    input.location,
    input.link,
    input.description,
    input.remote,
    input.contract,
    input.raw,
  ]
  return extractEmails(values)
}

export function extractEmails(values) {
  const found = new Set()
  const text = flattenValues(values).join(' ')
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  for (const match of matches) {
    const email = match.toLowerCase().replace(/[),.;:]+$/g, '')
    if (isLikelyEmail(email)) found.add(email)
  }
  return Array.from(found).sort()
}

export function extractSalaryFromText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ')
  const range = normalized.match(/(\d{2,3})\s*[kK]\s*(?:-|à|a|\/)\s*(\d{2,3})\s*[kK]/)
  if (range) return { min: Number(range[1]) * 1000, max: Number(range[2]) * 1000, currency: 'EUR' }
  const single = normalized.match(/(\d{2,3})\s*[kK]/)
  if (single) return { min: Number(single[1]) * 1000, max: null, currency: 'EUR' }
  return { min: null, max: null, currency: '' }
}

function toNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
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

function isLikelyEmail(email) {
  if (!email.includes('@') || email.length > 254) return false
  const domain = email.split('@')[1] || ''
  if (!domain.includes('.')) return false
  if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|ico)$/i.test(domain)) return false
  return true
}
