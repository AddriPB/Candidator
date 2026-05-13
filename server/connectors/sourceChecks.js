import { loadRadarConfig } from '../radar/config.js'
import { collectOffers } from '../radar/collector.js'

export async function checkSources() {
  const config = loadRadarConfig()
  const { logs } = await collectOffers(config)
  return logs.map((log) => ({
    source: log.source,
    ok: log.errorsCount === 0,
    detail: log.errorsCount ? log.error : `${log.offersCount} result(s)`,
  }))
}
