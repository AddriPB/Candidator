import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_CONFIG_PATH = './config/opportunity-radar.json'

export function loadRadarConfig(configPath = process.env.OPPORTUNITY_RADAR_CONFIG || DEFAULT_CONFIG_PATH) {
  const resolved = path.resolve(configPath)
  const raw = fs.readFileSync(resolved, 'utf8')
  return normalizeConfig(JSON.parse(raw))
}

export function normalizeConfig(config) {
  return {
    niveau_cible: config.niveau_cible || 'confirmé',
    annees_experience_min: config.annees_experience_min ?? null,
    contrat: config.contrat || 'CDI',
    salaire_min: config.salaire_min ?? null,
    teletravail_min_jours: config.teletravail_min_jours ?? null,
    zones: Array.isArray(config.zones) ? config.zones : ['Paris', 'Île-de-France', 'hybride IDF', 'full remote France'],
    sources_actives: Array.isArray(config.sources_actives)
      ? config.sources_actives
      : ['france_travail', 'adzuna', 'jsearch', 'careerjet'],
    autonomie_candidature: config.autonomie_candidature || 'validation_légère',
    blacklist_entreprises: Array.isArray(config.blacklist_entreprises) ? config.blacklist_entreprises : [],
    blacklist_secteurs: Array.isArray(config.blacklist_secteurs) ? config.blacklist_secteurs : [],
    reject_salary_below_threshold: config.reject_salary_below_threshold !== false,
    keep_unknown_salary: config.keep_unknown_salary !== false,
    daily_run_enabled: config.daily_run_enabled !== false,
    daily_run_schedule: normalizeDailyRunSchedule(config.daily_run_schedule),
    esn_contact_discovery: normalizeEsnContactDiscovery(config.esn_contact_discovery),
    web_contact_discovery: normalizeWebContactDiscovery(config.web_contact_discovery),
  }
}

export function normalizeDailyRunSchedule(schedule = {}) {
  const nightHours = Array.isArray(schedule.night_hours)
    ? schedule.night_hours
      .map((hour) => Number(hour))
      .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    : [2, 4, 6]

  return {
    timezone: schedule.timezone || 'Europe/Paris',
    night_hours: nightHours.length ? nightHours : [2, 4, 6],
    retry_interval_hours: positiveNumber(schedule.retry_interval_hours, 2),
    max_failures_per_day: positiveInteger(schedule.max_failures_per_day, 3),
    state_path: schedule.state_path || './data/radar-nightly-state.json',
  }
}

export function normalizeEsnContactDiscovery(discovery = {}) {
  return {
    enabled: discovery?.enabled === true,
    max_pages_per_company: positiveInteger(discovery?.max_pages_per_company, 6),
    companies: Array.isArray(discovery?.companies)
      ? discovery.companies
        .map((company) => {
          if (typeof company === 'string') return { name: company, domain: company }
          return {
            name: String(company?.name || company?.domain || company?.url || '').trim(),
            domain: String(company?.domain || '').trim(),
            url: String(company?.url || '').trim(),
            paths: Array.isArray(company?.paths) ? company.paths : undefined,
          }
        })
        .filter((company) => company.name && (company.domain || company.url))
      : [],
  }
}

export function normalizeWebContactDiscovery(discovery = {}) {
  return {
    enabled: discovery?.enabled === true,
    search_url_template: String(discovery?.search_url_template || 'https://html.duckduckgo.com/html/?q={query}'),
    max_results_per_query: positiveInteger(discovery?.max_results_per_query, 5),
    max_pages_per_query: positiveInteger(discovery?.max_pages_per_query, 3),
    queries: Array.isArray(discovery?.queries)
      ? discovery.queries
        .map((query) => {
          if (typeof query === 'string') return { label: query, query }
          const text = String(query?.query || query?.text || '').trim()
          return {
            label: String(query?.label || query?.company || text || '').trim(),
            query: text,
          }
        })
        .filter((query) => query.label && query.query)
      : [],
  }
}

function positiveNumber(value, fallback) {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback
}

function positiveInteger(value, fallback) {
  const normalized = Number(value)
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback
}
