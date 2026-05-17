import { collectOffers } from './collector.js'
import { dedupeOffers } from './dedupe.js'
import { evaluateOffer } from './filter.js'
import { scoreOffer } from './scorer.js'
import { writeReports } from './reporters/dailyReport.js'
import { saveRadarRun } from '../storage/database.js'
import { loadCandidateProfiles, selectCandidateProfile } from '../profiles/config.js'

export async function runDailyRadar({ config, db = null, outputDir = process.env.RADAR_OUTPUT_DIR || './data/radar-runs', logger = console } = {}) {
  if (config.daily_run_enabled === false) {
    logger.log('[radar] daily_run_enabled=false, run skipped')
    return null
  }

  const startedAt = new Date().toISOString()
  const collected = await collectOffers(config, { collectedAt: startedAt, logger })
  const deduped = dedupeOffers(collected.offers)
  const scoredOffers = deduped.offers.map((offer) => {
    const evaluation = evaluateOffer(offer, config)
    const scoring = scoreOffer(offer, evaluation, config)
    return { ...offer, evaluation, ...scoring }
  })

  const profiledOffers = assignCandidateProfiles(scoredOffers)
    .map((offer) => applyProfileRules(offer, config))
  const summary = buildSummary(profiledOffers, collected.logs, deduped.duplicates)
  const reports = writeReports({ startedAt, summary, offers: profiledOffers, logs: collected.logs, outputDir })
  if (db) saveRadarRun(db, { startedAt, summary, logs: collected.logs, offers: profiledOffers, reports })

  logger.log(`[radar] run complete: ${summary.opportunitiesDetected} detected, ${summary.toApply} to apply, ${summary.toWatch} to watch`)
  return { startedAt, summary, offers: profiledOffers, logs: collected.logs, reports }
}

function assignCandidateProfiles(offers) {
  const profiles = loadCandidateProfiles()
  if (!profiles.length) return offers
  return offers.map((offer) => {
    const profile = selectCandidateProfile(offer, profiles)
    return profile ? { ...offer, profilePseudo: profile.pseudo } : offer
  })
}

export function applyProfileRules(offer, config) {
  if (offer.profilePseudo !== 'léna') return offer
  const evaluation = applyLenaRules(offer)
  const scoring = scoreOffer(offer, evaluation, { ...config, salaire_min: null })
  return { ...offer, evaluation, ...scoring }
}

function applyLenaRules(offer) {
  const evaluation = offer.evaluation || {}
  const rejectReasons = (evaluation.rejectReasons || [])
    .filter((reason) => !['présentiel obligatoire', 'sous seuil rémunération'].includes(reason))
  const warnings = (evaluation.warnings || [])
    .filter((warning) => !['télétravail insuffisamment clair', 'rémunération inconnue'].includes(warning))

  if (!isJuniorOrUnspecified(offer)) rejectReasons.push('niveau trop expérimenté')

  return {
    ...evaluation,
    warnings,
    rejectReasons,
    status: rejectReasons.length ? 'à rejeter' : warnings.length ? 'à vérifier' : 'compatible',
  }
}

function isJuniorOrUnspecified(offer) {
  const title = normalizeForProfileRules(offer.title)
  const level = normalizeForProfileRules(offer.level)
  if (/(senior|confirme|experimente|responsable|manager|directeur)/.test(title)) return false
  if (!level) return true
  if (/(senior|confirme|experimente|experience exigee|responsable|manager|directeur)/.test(level)) return false
  if (/(debutant accepte|debutant|junior|sans experience)/.test(level)) return true
  const years = level.match(/\b(\d+)\s*an/)
  if (years) return Number(years[1]) <= 1
  const months = level.match(/\b(\d+)\s*mois/)
  if (months) return Number(months[1]) <= 12
  return true
}

function normalizeForProfileRules(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function buildSummary(offers, logs, duplicatesRemoved) {
  const rejected = offers.filter((offer) => offer.verdict === 'à rejeter')
  const toApply = offers.filter((offer) => offer.verdict === 'à candidater')
  const offersWithEmail = offers.filter((offer) => offer.hasEmail || offer.emails?.length)
  const toApplyWithEmail = toApply.filter((offer) => offer.hasEmail || offer.emails?.length)
  return {
    opportunitiesDetected: logs.reduce((sum, log) => sum + log.offersCount, 0),
    duplicatesRemoved,
    rejectedOutOfTarget: rejected.length,
    scoredOffers: offers.length,
    toApply: toApply.length,
    toWatch: offers.filter((offer) => offer.verdict === 'à surveiller').length,
    toReject: rejected.length,
    emails: {
      offersWithEmail: offersWithEmail.length,
      toApplyWithEmail: toApplyWithEmail.length,
      toApplyEmailRate: toApply.length ? Math.round((toApplyWithEmail.length / toApply.length) * 10000) / 100 : 0,
    },
    rejectBreakdown: {
      role: countReject(rejected, 'hors rôle'),
      contract: countReject(rejected, 'hors CDI'),
      zone: countReject(rejected, 'hors zone'),
      onsite: countReject(rejected, 'présentiel obligatoire'),
      salary: countReject(rejected, 'sous seuil rémunération'),
      blacklist: rejected.filter((offer) => offer.evaluation.rejectReasons.some((reason) => reason.includes('blacklist'))).length,
    },
  }
}

function countReject(offers, reason) {
  return offers.filter((offer) => offer.evaluation.rejectReasons.includes(reason)).length
}
