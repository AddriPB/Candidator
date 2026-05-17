import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_PROFILES_PATH = './config/candidate-profiles.local.json'

export function loadCandidateProfiles({
  env = process.env,
  configPath = env.CANDIDATE_PROFILES_CONFIG || process.env.CANDIDATE_PROFILES_CONFIG || DEFAULT_PROFILES_PATH,
} = {}) {
  const resolved = path.resolve(configPath)
  if (!fs.existsSync(resolved)) return []
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  const profiles = Array.isArray(raw?.profiles) ? raw.profiles : Array.isArray(raw) ? raw : []
  return profiles.map((profile, index) => normalizeProfile(profile, { index, env })).filter(Boolean)
}

export function selectCandidateProfile(offer, profiles = []) {
  if (!profiles.length) return null
  const text = normalizeText([offer?.title, offer?.description].join(' '))
  const title = normalizeText(offer?.title)
  const eligible = profiles
    .filter((profile) => !matchesAny(title, profile.excludedRoles))
    .map((profile) => ({
      profile,
      score: scoreProfile({ profile, title, text }),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.profile.pseudo.localeCompare(b.profile.pseudo))

  return eligible[0]?.profile || null
}

export function resolveProfileRuntime(profile) {
  if (!profile) return null
  const cvPath = profile.cvPath ? path.resolve(profile.cvPath) : ''
  const missing = []
  if (!profile.firstName) missing.push('prenom manquant')
  if (!profile.lastName) missing.push('nom manquant')
  if (!cvPath) missing.push('CV manquant')
  else if (!fs.existsSync(cvPath)) missing.push('CV introuvable')

  return {
    ...profile,
    cvPath,
    cvFileName: cvPath ? path.basename(cvPath) : '',
    ready: missing.length === 0,
    reason: missing.join(', '),
  }
}

export function profilePublicSummary(profile) {
  return {
    pseudo: profile.pseudo,
    label: profile.label || profile.pseudo,
    firstName: Boolean(profile.firstName),
    lastName: Boolean(profile.lastName),
    emailFrom: maskEmail(profile.emailFrom),
    smtpPrefix: profile.smtpPrefix || '',
    cvFileName: profile.cvPath ? path.basename(profile.cvPath) : '',
    targetRoles: profile.targetRoles,
    excludedRoles: profile.excludedRoles,
    dailyQuota: profile.dailyQuota,
  }
}

function normalizeProfile(profile, { index, env }) {
  const pseudo = sanitizeSegment(profile?.pseudo || profile?.user || profile?.id || `profil-${index + 1}`)
  if (!pseudo) return null
  const cvPath = String(profile?.cvPath || profile?.cv_path || '').trim()
  const smtpPrefix = sanitizeEnvPrefix(profile?.smtpPrefix || profile?.smtp_prefix || profile?.smtpEnvPrefix || profile?.smtp_env_prefix || '')
  return {
    pseudo,
    label: String(profile?.label || profile?.name || pseudo).trim(),
    firstName: String(profile?.firstName || profile?.first_name || '').trim(),
    lastName: String(profile?.lastName || profile?.last_name || '').trim(),
    phone: String(profile?.phone || profile?.telephone || '').trim(),
    emailFrom: String(profile?.emailFrom || profile?.email_from || prefixedEnv(env, smtpPrefix, 'APPLICATION_FROM') || prefixedEnv(env, smtpPrefix, 'MAIL_FROM') || env.APPLICATION_FROM || '').trim(),
    smtpPrefix,
    cvPath,
    targetRoles: normalizeTerms(profile?.targetRoles || profile?.target_roles || profile?.metiers_cibles),
    excludedRoles: normalizeTerms(profile?.excludedRoles || profile?.excluded_roles || profile?.metiers_exclus),
    template: normalizeTemplate(profile?.template || profile?.mailTemplate || profile?.mail_template),
    dailyQuota: positiveInteger(profile?.dailyQuota || profile?.daily_quota || profile?.quota_jour, positiveInteger(env.APPLICATION_EMAIL_DAILY_LIMIT, 20)),
  }
}

function prefixedEnv(env, prefix, name) {
  return prefix ? env[`${prefix}_${name}`] : ''
}

function normalizeTemplate(template = {}) {
  return {
    subject: String(template?.subject || template?.subjectTemplate || '').trim(),
    body: String(template?.body || template?.bodyTemplate || '').trim(),
  }
}

function scoreProfile({ profile, title, text }) {
  let score = 0
  for (const term of profile.targetRoles) {
    if (matchesTargetTerm(title, term)) score += 10
    else if (matchesTargetTerm(text, term)) score += 3
  }
  return score
}

function matchesTargetTerm(text, term) {
  if (text.includes(term)) return true
  if (term === 'conseiller funeraire') return /\bconseiller(?:\s+(?:conseillere|e))?(?:\s+\w+){0,2}\s+funeraire\b/.test(text)
  if (term === 'assistant funeraire') return /\bassistant(?:e)?(?:\s+\w+){0,2}\s+funeraire\b/.test(text)
  return false
}

function matchesAny(text, terms) {
  return terms.some((term) => text.includes(term))
}

function normalizeTerms(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean)
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function sanitizeSegment(value) {
  return String(value || '')
    .normalize('NFC')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^\p{L}0-9._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function sanitizeEnvPrefix(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function maskEmail(value) {
  const text = String(value || '').trim()
  const [local, domain] = text.split('@')
  if (!local || !domain) return text ? 'renseigné' : ''
  return `${local.slice(0, 2)}***@${domain}`
}
