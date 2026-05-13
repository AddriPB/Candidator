import { stableHash } from './hash.js'
import { normalizeText } from './text.js'

export function dedupeOffers(offers) {
  const seen = new Map()
  let duplicates = 0

  for (const offer of offers) {
    const key = dedupeKey(offer)
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, { ...offer, sources: [offer.source], duplicateKeys: [key] })
      continue
    }
    duplicates += 1
    existing.sources = Array.from(new Set([...existing.sources, offer.source]))
    existing.duplicateKeys.push(key)
    if (!existing.link && offer.link) existing.link = offer.link
    if (!existing.salaryMin && offer.salaryMin) existing.salaryMin = offer.salaryMin
    if (!existing.salaryMax && offer.salaryMax) existing.salaryMax = offer.salaryMax
    if (!existing.remote && offer.remote) existing.remote = offer.remote
  }

  return { offers: Array.from(seen.values()), duplicates }
}

function dedupeKey(offer) {
  if (offer.link) return `link:${normalizeUrl(offer.link)}`
  if (offer.sourceId) return `source:${offer.source}:${offer.sourceId}`
  const text = [
    offer.title,
    offer.company,
    offer.location,
    offer.source,
    String(offer.description || '').slice(0, 180),
  ].map(normalizeText).join('|')
  return `hash:${stableHash(text)}`
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return normalizeText(url)
  }
}
