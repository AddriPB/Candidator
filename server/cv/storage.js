import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ACTIVE_FILE = '.active-cv.json'
const APPLICATION_MAIL_FILE = '.application-mail.json'
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx'])
const MAX_FILE_SIZE = 10 * 1024 * 1024
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TITLE_PLACEHOLDER = '[Intitulé du poste]'

export function getCvState({ pseudo } = {}) {
  const resolvedPseudo = cvPseudo(pseudo)
  const dir = userCvDir(resolvedPseudo)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const files = listCvFiles(dir)
  const activeFile = readActiveFile(dir, files)
  return {
    pseudo: resolvedPseudo,
    storageDir: dir,
    activeFile,
    files,
    applicationMail: readApplicationMail(dir),
  }
}

export function saveCvUpload({ originalName, buffer, pseudo = '' }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'empty_file')
  if (buffer.length > MAX_FILE_SIZE) throw httpError(413, 'file_too_large')

  const resolvedPseudo = cvPseudo(pseudo)
  const dir = userCvDir(resolvedPseudo)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const fileName = availableFileName(dir, originalName)
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, buffer, { mode: 0o600 })
  writeActiveFile(dir, fileName)
  return getCvState({ pseudo: resolvedPseudo })
}

export function setActiveCv(fileName, { pseudo = '' } = {}) {
  const resolvedPseudo = cvPseudo(pseudo)
  const dir = userCvDir(resolvedPseudo)
  const safeName = sanitizeExistingFileName(fileName)
  const filePath = path.join(dir, safeName)
  if (!fs.existsSync(filePath)) throw httpError(404, 'cv_not_found')
  writeActiveFile(dir, safeName)
  return getCvState({ pseudo: resolvedPseudo })
}

export function cvDownloadPath(fileName, { pseudo = '' } = {}) {
  const dir = userCvDir(cvPseudo(pseudo))
  const safeName = sanitizeExistingFileName(fileName)
  const filePath = path.join(dir, safeName)
  if (!fs.existsSync(filePath)) throw httpError(404, 'cv_not_found')
  return { filePath, fileName: safeName }
}

export function saveApplicationMailTemplate(input = {}, { pseudo = '' } = {}) {
  const resolvedPseudo = cvPseudo(pseudo)
  const dir = userCvDir(resolvedPseudo)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const applicationMail = normalizeApplicationMail(input)
  fs.writeFileSync(
    path.join(dir, APPLICATION_MAIL_FILE),
    `${JSON.stringify(applicationMail, null, 2)}\n`,
    { mode: 0o600 },
  )
  return getCvState({ pseudo: resolvedPseudo })
}

export function cvPseudo(value = '') {
  return sanitizeSegment(value || process.env.CV_USER_PSEUDO || process.env.AUTH_USERNAME || 'adri')
}

function userCvDir(pseudo = '') {
  return path.join(cvRootDir(), cvPseudo(pseudo))
}

function cvRootDir() {
  const fallback = path.join(process.env.OPPORTUNITY_RADAR_PRIVATE_DIR || PROJECT_ROOT, 'cv')
  return path.resolve(process.env.CV_STORAGE_DIR || fallback)
}

function listCvFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isAllowedFile(entry.name))
    .map((entry) => {
      const filePath = path.join(dir, entry.name)
      const stat = fs.statSync(filePath)
      return {
        name: entry.name,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        extension: path.extname(entry.name).toLowerCase(),
      }
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function readActiveFile(dir, files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, ACTIVE_FILE), 'utf8'))
    const activeName = sanitizeExistingFileName(data?.activeFile)
    if (files.some((file) => file.name === activeName)) return activeName
  } catch {
    // Missing or invalid metadata means no active CV has been selected.
  }
  return ''
}

function readApplicationMail(dir) {
  try {
    return { ...normalizeApplicationMail(JSON.parse(fs.readFileSync(path.join(dir, APPLICATION_MAIL_FILE), 'utf8'))), configured: true }
  } catch {
    return { ...normalizeApplicationMail({}), configured: false }
  }
}

function normalizeApplicationMail(input = {}) {
  const firstName = cleanText(input.firstName, 80)
  const lastName = cleanText(input.lastName, 80)
  const phone = cleanText(input.phone, 40)
  const subjectTemplate = cleanTemplate(input.subjectTemplate, defaultSubjectTemplate())
  const bodyTemplate = cleanTemplate(input.bodyTemplate, defaultBodyTemplate({ firstName, lastName, phone }))

  return {
    firstName,
    lastName,
    phone,
    titlePlaceholder: TITLE_PLACEHOLDER,
    subjectTemplate,
    bodyTemplate,
  }
}

function defaultSubjectTemplate() {
  return `Candidature : ${TITLE_PLACEHOLDER}`
}

function defaultBodyTemplate({ firstName, lastName, phone }) {
  const signature = [firstName, lastName].filter(Boolean).join(' ').trim() || '[Prénom Nom]'
  const contactPhone = phone || '[Téléphone]'
  return `Bonjour,

Je vous adresse ma candidature pour le poste de ${TITLE_PLACEHOLDER}.

Offre concernée : [URL de l’offre]

Vous trouverez mon CV en pièce jointe. Je suis disponible pour échanger par téléphone afin de vous présenter mon profil.

Vous pouvez me joindre au ${contactPhone}.

Bien cordialement,
${signature}`
}

function cleanTemplate(value, fallback) {
  const text = cleanText(value, 5000)
  return text || fallback
}

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
    .slice(0, maxLength)
    .trim()
}

function writeActiveFile(dir, fileName) {
  fs.writeFileSync(path.join(dir, ACTIVE_FILE), `${JSON.stringify({ activeFile: fileName }, null, 2)}\n`, { mode: 0o600 })
}

function availableFileName(dir, originalName) {
  const safeName = sanitizeNewFileName(originalName)
  if (!fs.existsSync(path.join(dir, safeName))) return safeName

  const parsed = path.parse(safeName)
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${parsed.name} (${index})${parsed.ext.toLowerCase()}`
    if (!fs.existsSync(path.join(dir, candidate))) return candidate
  }
  throw httpError(409, 'too_many_duplicate_cv_names')
}

function sanitizeNewFileName(fileName) {
  const base = path.basename(String(fileName || '')).trim()
  if (!base) throw httpError(400, 'missing_file_name')
  const ext = path.extname(base).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) throw httpError(415, 'unsupported_file_type')
  const name = path.basename(base, ext)
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/[<>:"\\|?*]+/g, '')
    .slice(0, 80)
    .trim()
  if (!name) throw httpError(400, 'invalid_file_name')
  return `${name}${ext}`
}

function sanitizeExistingFileName(fileName) {
  const base = path.basename(String(fileName || '')).trim()
  if (!base || base === ACTIVE_FILE || !isAllowedFile(base)) throw httpError(400, 'invalid_file_name')
  return base
}

function isAllowedFile(fileName) {
  return ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

function sanitizeSegment(value) {
  const segment = String(value || '')
    .normalize('NFC')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^\p{L}0-9._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return segment || 'adri'
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
