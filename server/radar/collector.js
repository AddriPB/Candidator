import { fetchFranceTravailOffers } from './adapters/franceTravail.js'
import { fetchAdzunaOffers } from './adapters/adzuna.js'
import { fetchJSearchOffers } from './adapters/jsearch.js'
import { fetchCareerjetOffers } from './adapters/careerjet.js'
import { TARGET_QUERIES } from './queries.js'

const ADAPTERS = {
  france_travail: fetchFranceTravailOffers,
  adzuna: fetchAdzunaOffers,
  jsearch: fetchJSearchOffers,
  careerjet: fetchCareerjetOffers,
}

export async function collectOffers(config, { collectedAt = new Date().toISOString(), logger = console } = {}) {
  const activeSources = config.sources_actives || Object.keys(ADAPTERS)
  const allOffers = []
  const logs = []

  for (const source of activeSources) {
    const adapter = ADAPTERS[source]
    if (!adapter) {
      logs.push(logEntry({ collectedAt, source, error: `unknown source ${source}` }))
      continue
    }

    let sourceCount = 0
    let sourceErrors = 0
    let lastError = ''

    for (const query of TARGET_QUERIES) {
      try {
        const offers = await adapter({ query, collectedAt })
        sourceCount += offers.length
        allOffers.push(...offers)
      } catch (error) {
        sourceErrors += 1
        lastError = error.message
      }
    }

    const entry = logEntry({ collectedAt, source, offersCount: sourceCount, errorsCount: sourceErrors, error: lastError })
    logs.push(entry)
    logger.log(`[radar] ${entry.source}: ${entry.offersCount} offer(s), ${entry.errorsCount} error(s)${entry.error ? ` - ${entry.error}` : ''}`)
  }

  return { offers: allOffers, logs }
}

function logEntry({ collectedAt, source, offersCount = 0, errorsCount = 0, error = '' }) {
  return { checkedAt: collectedAt, source, offersCount, errorsCount, error }
}
