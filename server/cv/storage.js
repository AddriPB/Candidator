import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ACTIVE_FILE = '.active-cv.json'
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx'])
const MAX_FILE_SIZE = 10 * 1024 * 1024
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function getCvState() {
  const dir = userCvDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const files = listCvFiles(dir)
  const activeFile = readActiveFile(dir, files)
  return {
    pseudo: cvPseudo(),
    storageDir: dir,
    activeFile,
    files,
  }
}

export function saveCvUpload({ originalName, buffer }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'empty_file')
  if (buffer.length > MAX_FILE_SIZE) throw httpError(413, 'file_too_large')

  const dir = userCvDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const fileName = availableFileName(dir, originalName)
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, buffer, { mode: 0o600 })
  writeActiveFile(dir, fileName)
  return getCvState()
}

export function setActiveCv(fileName) {
  const dir = userCvDir()
  const safeName = sanitizeExistingFileName(fileName)
  const filePath = path.join(dir, safeName)
  if (!fs.existsSync(filePath)) throw httpError(404, 'cv_not_found')
  writeActiveFile(dir, safeName)
  return getCvState()
}

export function cvDownloadPath(fileName) {
  const dir = userCvDir()
  const safeName = sanitizeExistingFileName(fileName)
  const filePath = path.join(dir, safeName)
  if (!fs.existsSync(filePath)) throw httpError(404, 'cv_not_found')
  return { filePath, fileName: safeName }
}

export function cvPseudo() {
  return sanitizeSegment(process.env.CV_USER_PSEUDO || process.env.AUTH_USERNAME || 'adri')
}

function userCvDir() {
  return path.join(cvRootDir(), cvPseudo())
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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return segment || 'adri'
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
