import { normalizeText } from '../normalizer/index.js'

const INCLUDE = [
  'product owner',
  'product manager',
  'business analyst',
  'proxy po',
  'chef de projet digital',
  'consultant amoa',
  'consultant moa',
  'amoa',
  'moa',
]

const EXCLUDE = [
  'developpeur ia',
  'data scientist',
  'prompt engineer',
  'scrum master',
  'delivery manager',
  'qa engineer',
  'testeur qa',
  'product ops',
  'devops',
  'fullstack',
  'backend',
  'frontend',
]

export function evaluateOffer(offer, settings) {
  const haystack = normalizeText(`${offer.title} ${offer.description} ${offer.company}`)
  const negatives = []

  if (!INCLUDE.some((term) => haystack.includes(term))) negatives.push('rôle hors cible PO/PM/BA/AMOA')
  if (EXCLUDE.some((term) => haystack.includes(term))) negatives.push('rôle exclu par défaut')
  if (offer.contractType && !normalizeText(offer.contractType).includes(normalizeText(settings.contrat))) {
    negatives.push('contrat non-CDI')
  }
  if (offer.salaryMax && offer.salaryMax < settings.salaire_min) negatives.push('rémunération sous seuil')
  if (isBlacklisted(offer.company, settings.blacklist_entreprises)) negatives.push('entreprise blacklistée')
  if (isBlacklisted(haystack, settings.blacklist_secteurs)) negatives.push('secteur blacklisté')
  if (isMandatoryOnsite(offer)) negatives.push('présentiel obligatoire')
  if (isOutsideTargetZone(offer)) negatives.push('hors IDF sans full remote France')

  return {
    keep: negatives.length === 0,
    negatives,
  }
}

function isBlacklisted(value, list = []) {
  const normalized = normalizeText(value)
  return list.some((item) => normalized.includes(normalizeText(item)))
}

function isMandatoryOnsite(offer) {
  const remote = normalizeText(`${offer.remoteRaw} ${offer.description}`)
  return remote.includes('presentiel obligatoire') || remote.includes('sur site obligatoire')
}

function isOutsideTargetZone(offer) {
  const loc = normalizeText(`${offer.location} ${offer.remoteRaw}`)
  const fullRemote = loc.includes('remote') || loc.includes('teletravail complet') || loc.includes('full remote')
  const idf = ['paris', 'ile-de-france', 'idf', 'hauts-de-seine', 'seine-saint-denis', 'val-de-marne', 'yvelines', 'essonne', 'val-d-oise', 'seine-et-marne'].some((term) => loc.includes(term))
  return !idf && !fullRemote
}
