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
  }
}
