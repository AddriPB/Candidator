import { normalizeText } from '../normalizer/index.js'

export function scoreOffer(offer, settings, filterResult = { negatives: [] }) {
  const positiveSignals = []
  const negativeSignals = [...filterResult.negatives]
  const missingData = []

  const salary = scoreSalary(offer, settings, positiveSignals, negativeSignals, missingData)
  const remote = scoreRemote(offer, settings, positiveSignals, negativeSignals, missingData)
  const role = scoreRole(offer, positiveSignals, negativeSignals)
  const quality = scoreQuality(offer, positiveSignals, negativeSignals, missingData)
  const score = Math.max(0, Math.min(100, salary + remote + role + quality - negativeSignals.length * 4))
  const verdict = score >= 75 && filterResult.negatives.length === 0 ? 'à candidater' : score >= 55 ? 'à surveiller' : 'à rejeter'

  return {
    score,
    verdict,
    why: buildWhy(score, verdict, positiveSignals, negativeSignals),
    positiveSignals,
    negativeSignals,
    missingData,
    proposedAction: verdict === 'à candidater'
      ? 'Préparer une candidature manuelle après vérification de la fiche.'
      : verdict === 'à surveiller'
        ? 'Relire les données manquantes avant décision.'
        : 'Ignorer sauf information nouvelle.',
  }
}

function scoreSalary(offer, settings, positives, negatives, missing) {
  const min = offer.salaryMin
  const max = offer.salaryMax
  if (!min && !max) {
    missing.push('rémunération')
    return 18
  }
  const ref = max || min
  if (ref >= settings.salaire_min + 10000) {
    positives.push('rémunération au-dessus du seuil')
    return 40
  }
  if (ref >= settings.salaire_min) {
    positives.push('rémunération compatible')
    return 32
  }
  negatives.push('rémunération insuffisante')
  return 8
}

function scoreRemote(offer, settings, positives, negatives, missing) {
  const remote = normalizeText(`${offer.remoteRaw} ${offer.description}`)
  const days = extractRemoteDays(remote)
  if (remote.includes('full remote') || remote.includes('remote france') || remote.includes('teletravail complet')) {
    positives.push('full remote compatible France')
    return 30
  }
  if (days >= settings.teletravail_min_jours) {
    positives.push(`${days} jours de télétravail détectés`)
    return 26
  }
  if (remote.includes('hybride') || remote.includes('teletravail')) {
    positives.push('hybride ou télétravail mentionné')
    return 20
  }
  if (!remote.trim()) {
    missing.push('télétravail')
    return 12
  }
  negatives.push('télétravail insuffisant ou incertain')
  return 6
}

function scoreRole(offer, positives, negatives) {
  const text = normalizeText(`${offer.title} ${offer.description}`)
  if (text.includes('product owner') || text.includes('product manager')) {
    positives.push('rôle produit direct')
    return 20
  }
  if (text.includes('business analyst') || text.includes('amoa') || text.includes('moa')) {
    positives.push('rôle métier/AMOA compatible')
    return 17
  }
  if (text.includes('chef de projet digital') || text.includes('proxy po')) {
    positives.push('rôle digital proche produit')
    return 15
  }
  negatives.push('adéquation rôle faible')
  return 5
}

function scoreQuality(offer, positives, negatives, missing) {
  let points = 0
  if (offer.company && offer.company !== 'Entreprise non communiquée') points += 2
  else missing.push('entreprise')
  if (offer.url) points += 2
  else missing.push('url')
  if (offer.description && offer.description.length > 300) points += 3
  else missing.push('description détaillée')
  if (offer.publishedAt) points += 2
  else missing.push('date de publication')
  if (offer.location) points += 1
  if (points >= 8) positives.push('fiche suffisamment détaillée')
  if (points <= 4) negatives.push('qualité de fiche faible')
  return points
}

function extractRemoteDays(value) {
  const match = value.match(/(\d)\s*(?:j|jour|jours)/)
  return match ? Number(match[1]) : 0
}

function buildWhy(score, verdict, positives, negatives) {
  const main = positives.slice(0, 2).join(', ') || 'opportunité partiellement compatible'
  const risk = negatives.length ? ` Risques: ${negatives.slice(0, 2).join(', ')}.` : ''
  return `Score ${score}/100, verdict ${verdict}: ${main}.${risk}`
}
