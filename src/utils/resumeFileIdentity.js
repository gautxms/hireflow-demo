const MIME_TYPE_LABELS = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/plain': 'TXT',
}

const EXTENSION_LABELS = {
  pdf: 'PDF',
  doc: 'DOC',
  docx: 'DOCX',
  txt: 'TXT',
}

function cleanString(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return fallback
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

export function getFilenameExtension(filename = '') {
  const normalized = cleanString(filename, '')
  const match = normalized.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : ''
}

export function resolveResumeMimeType(file = {}) {
  return cleanString(
    file.originalMimeType
      || file.original_mime_type
      || file.mimeType
      || file.mime_type
      || file.fileType
      || file.file_type
      || file.type,
    '',
  ).toLowerCase()
}

export function resolveResumeFileType(file = {}) {
  const explicit = cleanString(file.fileTypeLabel || file.format || file.fileFormat, '').toUpperCase()
  if (['PDF', 'DOC', 'DOCX', 'TXT'].includes(explicit)) return explicit

  const extension = cleanString(file.fileExtension || file.file_extension || getFilenameExtension(file.originalFilename || file.original_filename || file.filename || file.name), '').toLowerCase().replace(/^\./, '')
  if (EXTENSION_LABELS[extension]) return EXTENSION_LABELS[extension]

  const mimeType = resolveResumeMimeType(file)
  return MIME_TYPE_LABELS[mimeType] || 'Unknown'
}

export function resolveResumeDisplayFilename(file = {}, fallback = 'Unknown file') {
  const originalFilename = cleanString(file.originalFilename || file.original_filename, '')
  const filename = cleanString(file.filename || file.fileName || file.file_name || file.name || file.resume_filename, '')
  const candidate = originalFilename || filename
  if (!candidate) return fallback

  if (getFilenameExtension(candidate)) return candidate

  const extension = cleanString(file.fileExtension || file.file_extension, '').replace(/^\./, '').toLowerCase()
  if (extension) return `${candidate}.${extension}`

  return candidate
}

export function buildResumeFileIdentity(file = {}, fallback = 'Unknown file') {
  const filename = resolveResumeDisplayFilename(file, fallback)
  const fileType = resolveResumeFileType(file)
  const mimeType = resolveResumeMimeType(file)
  const hasExtension = Boolean(getFilenameExtension(filename))
  const badge = hasExtension ? fileType : (mimeType || fileType)

  return {
    filename,
    fileType,
    mimeType,
    badge: badge || 'Unknown',
    hasExtension,
  }
}

export function toSafeResumeFailureReason(value, file = {}) {
  const raw = cleanString(value, '')
  const normalized = raw.toLowerCase()
  const fileType = resolveResumeFileType(file)

  if (fileType === 'DOC' || normalized.includes('legacy word') || normalized.includes('.doc') || normalized.includes('application/msword')) {
    return 'Legacy Word .doc files are not supported. Please upload this resume as DOCX or text-based PDF.'
  }

  if (fileType === 'DOCX' || normalized.includes('docx') || normalized.includes('wordprocessingml')) {
    if (normalized.includes('extract') || normalized.includes('mammoth') || normalized.includes('text')) {
      return 'DOCX text extraction failed. Try regenerating the DOCX with selectable text or upload a text-based PDF.'
    }
  }

  if (normalized.includes('json') || normalized.includes('{') || normalized.includes('}') || normalized.includes('stack') || normalized.includes('syntaxerror')) {
    return 'Resume processing failed. Please upload a text-based PDF or DOCX and try again.'
  }

  if (normalized.includes('ocr') || normalized.includes('optical character recognition')) return 'OCR could not recover readable resume content. Please upload a text-based PDF or DOCX.'
  if (normalized.includes('pdf') && (normalized.includes('unextract') || normalized.includes('extract') || normalized.includes('selectable'))) return 'PDF text extraction failed. Please upload a text-based PDF or DOCX.'
  if (normalized.includes('corrupt') || normalized.includes('invalid')) return 'Resume file appears corrupted or unreadable. Please re-save the file and upload again.'
  if (normalized.includes('unsupported')) return 'This resume format is not supported. Please upload a DOCX, TXT, or text-based PDF.'

  return raw || 'Resume processing failed. Please upload a text-based PDF or DOCX and try again.'
}
