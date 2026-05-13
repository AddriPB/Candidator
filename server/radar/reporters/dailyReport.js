import fs from 'node:fs'
import path from 'node:path'

export function writeReports({ startedAt, summary, offers, logs, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true })
  const day = startedAt.slice(0, 10)
  const base = path.join(outputDir, `opportunity-radar-${day}`)
  const jsonPath = `${base}.json`
  const markdownPath = `${base}.md`
  fs.writeFileSync(jsonPath, `${JSON.stringify({ startedAt, summary, logs, offers }, null, 2)}\n`)
  fs.writeFileSync(markdownPath, renderMarkdown({ day, summary, offers }))
  return { jsonPath, markdownPath }
}

export function renderMarkdown({ day, summary, offers }) {
  const toApply = sortByScore(offers.filter((offer) => offer.verdict === 'à candidater')).slice(0, 10)
  const retained = sortByScore(offers.filter((offer) => offer.verdict !== 'à rejeter'))

  return `# Opportunity Radar — Synthèse quotidienne — ${day}

Opportunités détectées : ${summary.opportunitiesDetected}
Doublons supprimés : ${summary.duplicatesRemoved}
Hors cible rejetées : ${summary.rejectedOutOfTarget}
Offres scorées : ${summary.scoredOffers}
À candidater : ${summary.toApply}
À surveiller : ${summary.toWatch}
À rejeter : ${summary.toReject}

## Top offres à candidater
${listTopOffers(toApply)}

## Rejets principaux
- ${summary.rejectBreakdown.role} offres hors rôle
- ${summary.rejectBreakdown.contract} offres hors CDI
- ${summary.rejectBreakdown.zone} offres hors zone
- ${summary.rejectBreakdown.onsite} offres présentiel obligatoire
- ${summary.rejectBreakdown.salary} offres sous seuil rémunération
- ${summary.rejectBreakdown.blacklist} offres blacklistées

## Fiches courtes
${retained.map(renderOfferCard).join('\n\n') || 'Aucune offre retenue.'}
`
}

function listTopOffers(offers) {
  if (!offers.length) return 'Aucune offre à candidater.'
  return offers.map((offer, index) => `${index + 1}. [${safe(offer.title)}](${offer.link || '#'}) — ${safe(offer.company)} — Score ${offer.score}/100 — ${offer.source}
   Pourquoi : ${offer.why}
   Angle de candidature : ${offer.applicationAngle}
   Points de vigilance : ${offer.vigilance.length ? offer.vigilance.join(', ') : 'Aucun point majeur détecté.'}`).join('\n\n')
}

function renderOfferCard(offer) {
  return `### ${safe(offer.title)}

Titre : ${safe(offer.title)}
Entreprise : ${safe(offer.company)}
Localisation : ${safe(offer.location)}
Télétravail : ${safe(offer.evaluation.remote.label)}
Contrat : ${safe(offer.contract || offer.evaluation.contract.label)}
Rémunération : ${formatSalary(offer)}
Source : ${safe(offer.source)}
Lien : ${offer.link || 'Non renseigné'}
Score : ${offer.score}/100
Verdict : ${offer.verdict}
Pourquoi : ${offer.why}
Angle de candidature : ${offer.applicationAngle}
Actions proposées : ${offer.verdict === 'à candidater' ? 'Préparer une candidature ciblée après validation légère.' : 'Vérifier les zones floues avant décision.'}`
}

function sortByScore(offers) {
  return [...offers].sort((a, b) => b.score - a.score)
}

function formatSalary(offer) {
  if (!offer.salaryMin && !offer.salaryMax) return 'Non renseignée'
  const min = offer.salaryMin ? `${offer.salaryMin}` : ''
  const max = offer.salaryMax ? `${offer.salaryMax}` : ''
  return `${min}${min && max ? ' - ' : ''}${max} ${offer.currency || ''}`.trim()
}

function safe(value) {
  return String(value || 'Non renseigné').replace(/\|/g, '-')
}
