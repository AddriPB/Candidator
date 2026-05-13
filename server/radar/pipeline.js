import { collectOffers } from './collector.js'
import { dedupeOffers } from './dedupe.js'
import { evaluateOffer } from './filter.js'
import { scoreOffer } from './scorer.js'
import { writeReports } from './reporters/dailyReport.js'
import { saveRadarRun } from '../storage/database.js'

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

  const summary = buildSummary(scoredOffers, collected.logs, deduped.duplicates)
  const reports = writeReports({ startedAt, summary, offers: scoredOffers, logs: collected.logs, outputDir })
  if (db) saveRadarRun(db, { startedAt, summary, logs: collected.logs, offers: scoredOffers, reports })

  logger.log(`[radar] run complete: ${summary.opportunitiesDetected} detected, ${summary.toApply} to apply, ${summary.toWatch} to watch`)
  return { startedAt, summary, offers: scoredOffers, logs: collected.logs, reports }
}

function buildSummary(offers, logs, duplicatesRemoved) {
  const rejected = offers.filter((offer) => offer.verdict === 'à rejeter')
  return {
    opportunitiesDetected: logs.reduce((sum, log) => sum + log.offersCount, 0),
    duplicatesRemoved,
    rejectedOutOfTarget: rejected.length,
    scoredOffers: offers.length,
    toApply: offers.filter((offer) => offer.verdict === 'à candidater').length,
    toWatch: offers.filter((offer) => offer.verdict === 'à surveiller').length,
    toReject: rejected.length,
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
