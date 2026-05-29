const EXTENSION_MIME_MAP = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
}

const ACCEPTED_RESUME_MIME_TYPES = new Set(Object.values(EXTENSION_MIME_MAP))

export function getFileExtension(filename) {
  const safeFilename = String(filename || '').trim()
  const lastDotIndex = safeFilename.lastIndexOf('.')

  if (lastDotIndex <= 0 || lastDotIndex === safeFilename.length - 1) {
    return ''
  }

  return safeFilename.slice(lastDotIndex + 1).toLowerCase()
}

export function resolveEffectiveMimeType(reportedMimeType, filename) {
  const normalizedMimeType = String(reportedMimeType || '').trim().toLowerCase()
  const extension = getFileExtension(filename)
  const extensionMimeType = EXTENSION_MIME_MAP[extension]

  if (extensionMimeType) {
    return extensionMimeType
  }

  return normalizedMimeType || null
}

export function isAcceptedResumeUpload(reportedMimeType, filename) {
  const effectiveMimeType = resolveEffectiveMimeType(reportedMimeType, filename)
  if (effectiveMimeType === EXTENSION_MIME_MAP.txt) {
    return getFileExtension(filename) === 'txt'
  }

  return ACCEPTED_RESUME_MIME_TYPES.has(effectiveMimeType)
}
