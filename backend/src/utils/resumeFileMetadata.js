import { getFileExtension, resolveEffectiveMimeType } from './fileMime.js'
import { sanitizeText } from './sanitize.js'

const MIME_EXTENSION_MAP = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
}

function sanitizeFilenamePart(value, fallback) {
  const sanitized = sanitizeText(value)
    .replace(/[^a-zA-Z0-9_ -]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  return sanitized || fallback
}

export function sanitizeFilenameWithExtension(value) {
  const normalized = sanitizeText(value)
  const extension = getFileExtension(normalized)
  const extensionSuffix = extension ? `.${extension}` : ''
  const withoutExtension = extension ? normalized.slice(0, -(extension.length + 1)) : normalized
  const safeBase = sanitizeFilenamePart(withoutExtension, 'resume')

  return `${safeBase}${extensionSuffix}`
}

export function getOriginalFilename(resume = {}) {
  return String(
    resume.original_filename
      || resume.originalFilename
      || resume.filename
      || resume.fileName
      || resume.file_name
      || '',
  ).trim()
}

export function getDisplayFilename(resume = {}) {
  const originalFilename = getOriginalFilename(resume)
  if (getFileExtension(originalFilename)) {
    return originalFilename
  }

  const storedFilename = String(resume.filename || resume.fileName || resume.file_name || '').trim()
  if (getFileExtension(storedFilename)) {
    return storedFilename
  }

  const extension = String(
    resume.file_extension
      || resume.fileExtension
      || MIME_EXTENSION_MAP[String(resume.file_type || resume.fileType || '').trim().toLowerCase()]
      || '',
  ).trim().toLowerCase()

  if (storedFilename && extension) return `${storedFilename}.${extension}`
  if (originalFilename && extension) return `${originalFilename}.${extension}`
  return storedFilename || originalFilename || 'resume'
}

export function normalizeResumeFileMetadata({ filename, originalFilename, reportedMimeType, mimeType, mimetype } = {}) {
  const sourceFilename = String(originalFilename || filename || '').trim()
  const safeOriginalFilename = sanitizeFilenameWithExtension(sourceFilename)
  const originalMimeType = String(reportedMimeType || mimetype || mimeType || '').trim().toLowerCase() || null
  const normalizedMimeType = resolveEffectiveMimeType(originalMimeType, safeOriginalFilename) || originalMimeType
  const fileExtension = getFileExtension(safeOriginalFilename)

  return {
    originalFilename: safeOriginalFilename,
    displayFilename: safeOriginalFilename,
    storageFilename: safeOriginalFilename,
    fileExtension,
    originalMimeType,
    normalizedMimeType,
  }
}

export { getFileExtension }
