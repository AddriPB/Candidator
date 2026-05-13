export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function includesAny(text, terms) {
  const normalized = normalizeText(text)
  return terms.some((term) => normalized.includes(normalizeText(term)))
}

export function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}
