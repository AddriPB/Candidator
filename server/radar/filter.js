import { includesAny, normalizeText } from './text.js'

const CLEAR_TARGET_ROLES = [
  'product owner',
  'product manager',
  'business analyst',
  'proxy po',
  'proxy product owner',
  'chef de projet digital',
  'consultant amoa',
  'consultant moa',
]

const CLEAR_TARGET_ROLE_PATTERNS = [
  /\bpo\b/,
  /\bpm\b/,
  /\bba\b/,
  /\bmoa\b/,
  /\bamoa\b/,
  /\bproxy\s+po\b/,
]

const COMPATIBLE_ROLES = ['chef de projet web', 'project manager digital']

const EXCLUDED_ROLES = [
  'developpeur ia',
  'developpeur logiciel',
  'developpeur fullstack',
  'developpeur full stack',
  'developpeur backend',
  'developpeur front',
  'software engineer',
  'data scientist',
  'data engineer',
  'prompt engineer',
  'qa engineer',
  'testeur qa',
  'scrum master',
  'delivery manager',
  'product ops',
]

const PRODUCT_CONTEXT = ['produit', 'product', 'metier', 'client', 'roadmap', 'backlog', 'user story', 'agile', 'discovery']
const AI_TERMS = [' ia ', 'intelligence artificielle', 'genai', 'générative', 'llm', 'machine learning']

export function evaluateOffer(offer, config) {
  const text = normalizeText([offer.title, offer.description].join(' '))
  const title = normalizeText(offer.title)
  const reasons = []
  const warnings = []
  const rejectReasons = []

  const role = detectRole(title, text)
  if (role.status === 'reject') rejectReasons.push('hors rôle')
  if (role.status === 'ambiguous') warnings.push(role.reason)

  const contract = detectContract(offer, config)
  if (contract.status === 'reject') rejectReasons.push('hors CDI')
  if (contract.status === 'unknown') warnings.push('contrat insuffisamment clair')

  const zone = detectZone(offer)
  if (zone.status === 'reject') rejectReasons.push('hors zone')
  if (zone.status === 'unknown') warnings.push('zone insuffisamment claire')

  const remote = detectRemote(offer)
  if (remote.status === 'reject') rejectReasons.push('présentiel obligatoire')
  if (remote.status === 'unknown') warnings.push('télétravail insuffisamment clair')

  const salary = detectSalary(offer, config)
  if (salary.status === 'reject') rejectReasons.push('sous seuil rémunération')
  if (salary.status === 'unknown') warnings.push('rémunération inconnue')

  const blacklist = detectBlacklist(offer, config)
  if (blacklist.length) rejectReasons.push(...blacklist)

  if (includesAny(text, PRODUCT_CONTEXT)) reasons.push('contexte produit / métier détecté')
  if (hasAiDifferentiator(text) && role.status !== 'reject') reasons.push('IA valorisable comme argument différenciant produit / BA')

  const status = rejectReasons.length ? 'à rejeter' : warnings.length ? 'à vérifier' : 'compatible'
  return { status, role, contract, zone, remote, salary, reasons, warnings, rejectReasons }
}

export function detectRole(title, text = title) {
  if (hasClearTargetRole(title)) return { status: 'clear', label: 'rôle cible clair' }
  if (includesAny(title, COMPATIBLE_ROLES)) return { status: 'compatible', label: 'chef de projet digital compatible' }
  if (includesAny(title, EXCLUDED_ROLES)) return { status: 'reject', label: 'rôle exclu' }
  if (hasClearTargetRole(text)) return { status: 'ambiguous', label: 'rôle cible dans la description', reason: 'rôle ambigu' }
  if (includesAny(text, EXCLUDED_ROLES) && !includesAny(text, PRODUCT_CONTEXT)) return { status: 'reject', label: 'rôle trop technique' }
  return { status: 'reject', label: 'rôle hors cible' }
}

export function detectContract(offer, config) {
  const text = normalizeText([offer.contract, offer.title, offer.description].join(' '))
  if (/(stage|alternance|cdd|freelance|independant|indépendant|interim|intérim|tjm|€\s*\/\s*j|e\s*par\s*j)/.test(text)) {
    return { status: 'reject', label: 'non CDI' }
  }
  if (text.includes('cdi') || text.includes('full-time') || text.includes('full time')) return { status: 'ok', label: config.contrat }
  return { status: 'unknown', label: 'inconnu' }
}

export function detectZone(offer) {
  const text = normalizeText([offer.location, offer.remote, offer.description].join(' '))
  if (/(full remote|remote france|teletravail france|100% remote|100 teletravail)/.test(text)) return { status: 'ok', label: 'full remote France' }
  if (/(paris|ile-de-france|ile de france|idf|hauts-de-seine|seine-saint-denis|val-de-marne|yvelines|essonne|val-d'oise|val d'oise|seine-et-marne)/.test(text)) {
    return { status: 'ok', label: 'Île-de-France' }
  }
  if (/(lyon|marseille|lille|bordeaux|toulouse|nantes|rennes|strasbourg|grenoble)/.test(text) && !text.includes('remote')) {
    return { status: 'reject', label: 'hors zone' }
  }
  return { status: 'unknown', label: 'inconnue' }
}

export function detectRemote(offer) {
  const text = normalizeText([offer.remote, offer.title, offer.description].join(' '))
  if (/(full remote|100% remote|full teletravail|100 teletravail|remote france)/.test(text)) return { status: 'full', label: 'full remote France', points: 30 }
  if (/(3 jours|4 jours|hybride favorable|teletravail partiel|hybrid)/.test(text)) return { status: 'hybrid_good', label: 'hybride IDF favorable', points: 24 }
  if (/(2 jours|hybride|teletravail)/.test(text)) return { status: 'hybrid_medium', label: 'hybride IDF moyen', points: 15 }
  if (/(1 jour)/.test(text)) return { status: 'hybrid_low', label: 'hybride IDF faible', points: 8 }
  if (/(presentiel obligatoire|présentiel obligatoire|sur site obligatoire|pas de teletravail|pas de télétravail)/.test(text)) return { status: 'reject', label: 'présentiel obligatoire', points: 0 }
  return { status: 'unknown', label: 'inconnu', points: 8 }
}

export function detectSalary(offer, config) {
  const threshold = Number(config.salaire_min)
  const value = offer.salaryMin || offer.salaryMax
  if (!threshold) return value ? { status: 'ok', label: `${value}` } : { status: 'unknown', label: 'inconnue' }
  if (!value) return config.keep_unknown_salary ? { status: 'unknown', label: 'inconnue' } : { status: 'reject', label: 'inconnue' }
  if (value < threshold && config.reject_salary_below_threshold) return { status: 'reject', label: `${value}` }
  if (value < threshold) return { status: 'low', label: `${value}` }
  return { status: 'ok', label: `${value}` }
}

function detectBlacklist(offer, config) {
  const company = normalizeText(offer.company)
  const text = normalizeText([offer.title, offer.company, offer.description].join(' '))
  const rejected = []
  if ((config.blacklist_entreprises || []).some((item) => company.includes(normalizeText(item)))) rejected.push('entreprise blacklistée')
  if ((config.blacklist_secteurs || []).some((item) => text.includes(normalizeText(item)))) rejected.push('secteur blacklisté')
  return rejected
}

function hasAiDifferentiator(text) {
  return includesAny(` ${text} `, AI_TERMS)
}

function hasClearTargetRole(value) {
  const text = normalizeText(value)
  return includesAny(text, CLEAR_TARGET_ROLES) || CLEAR_TARGET_ROLE_PATTERNS.some((pattern) => pattern.test(text))
}
