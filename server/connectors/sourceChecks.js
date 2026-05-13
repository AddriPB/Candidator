import { loadRadarConfig } from '../radar/config.js'
import { collectOffers } from '../radar/collector.js'

export async function checkSources() {
  const config = loadRadarConfig()
  const { logs } = await collectOffers(config)
  return logs.map((log) => ({
    source: log.source,
    ok: log.errorsCount === 0 || log.offersCount > 0,
    detail: log.errorsCount
      ? `${log.offersCount} result(s), ${log.errorsCount} partial error(s): ${log.error}`
      : `${log.offersCount} result(s)`,
  }))
}
