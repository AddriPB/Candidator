import { includesAny, normalizeText } from './text.js'

export function scoreOffer(offer, evaluation, config) {
  const salary = scoreSalary(offer, config)
  const remote = scoreRemote(evaluation.remote)
  const role = scoreRole(evaluation.role)
  const opportunity = scoreOpportunity(offer, evaluation)
  const score = salary + remote + role + opportunity
  const verdict = verdictFor(score, evaluation)

  return {
    score,
    scoreDetails: { salary, remote, role, opportunity },
    verdict,
    why: buildWhy(offer, evaluation, score),
    applicationAngle: buildApplicationAngle(offer, evaluation),
    vigilance: [...evaluation.warnings, ...evaluation.rejectReasons],
  }
}

export function scoreSalary(offer, config) {
  const threshold = Number(config.salaire_min)
  const value = offer.salaryMin || offer.salaryMax
  if (!threshold) return value ? 32 : 10
  if (!value) return 10
  if (value >= threshold * 1.15) return 40
  if (value >= threshold) return 32
  if (value >= threshold * 0.9) return 20
  return 0
}

export function scoreRemote(remote) {
  return remote.points ?? 8
}

export function scoreRole(role) {
  if (role.status === 'clear') return 20
  if (role.status === 'ambiguous') return 12
  if (role.status === 'compatible') return 10
  return 0
}

function scoreOpportunity(offer, evaluation) {
  const text = normalizeText([offer.title, offer.description].join(' '))
  let score = 0
  if (includesAny(text, ['produit', 'product', 'metier', 'métier', 'roadmap', 'backlog', 'client'])) score += 4
  if (includesAny(text, ['structurant', 'transformation', 'cadrage', 'refonte', 'lancement', 'from scratch'])) score += 3
  if (evaluation.reasons.some((reason) => reason.includes('IA valorisable'))) score += 3
  return Math.min(score, 10)
}

function verdictFor(score, evaluation) {
  if (evaluation.rejectReasons.length) return 'à rejeter'
  return 'à candidater'
}

function buildWhy(offer, evaluation, score) {
  if (evaluation.rejectReasons.length) return `Incompatible: ${evaluation.rejectReasons.join(', ')}.`
  const reasons = evaluation.reasons.length ? evaluation.reasons.join(', ') : evaluation.role.label
  return `${reasons}. Score ${score}/100.`
}

function buildApplicationAngle(offer, evaluation) {
  if (evaluation.rejectReasons.length) return ''
  const ai = evaluation.reasons.some((reason) => reason.includes('IA valorisable'))
  if (ai) return 'Positionner l’expérience produit / BA, avec l’IA comme accélérateur de cadrage, priorisation ou analyse métier.'
  if (evaluation.role.status === 'clear') return 'Mettre en avant le pilotage produit, la traduction métier et la priorisation orientée impact.'
  return 'Clarifier rapidement le périmètre produit / métier avant candidature.'
}
