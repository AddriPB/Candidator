import { fetchAdzunaOffers } from '../radar/adapters/adzuna.js'
import { fetchCareerjetOffers } from '../radar/adapters/careerjet.js'
import { fetchFranceTravailOffers } from '../radar/adapters/franceTravail.js'
import { fetchJSearchOffers } from '../radar/adapters/jsearch.js'

const SMOKE_QUERY = 'Product Owner'

const CHECKS = [
  ['france_travail', fetchFranceTravailOffers],
  ['adzuna', fetchAdzunaOffers],
  ['jsearch', fetchJSearchOffers],
  ['careerjet', fetchCareerjetOffers],
]

export async function checkSources() {
  const checkedAt = new Date().toISOString()
  const checks = await Promise.allSettled(
    CHECKS.map(async ([source, adapter]) => {
      const offers = await adapter({ query: SMOKE_QUERY, collectedAt: checkedAt })
      return { source, ok: true, detail: `${offers.length} result(s)` }
    }),
  )

  return checks.map((check, index) => {
    if (check.status === 'fulfilled') return check.value
    return { source: CHECKS[index][0], ok: false, detail: check.reason?.message || 'unknown error' }
  })
}
