export const LEGACY_WORD_MIME_TYPE = 'application/msword'
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const UNSUPPORTED_LEGACY_WORD_CATEGORY = 'resume_unsupported_legacy_doc'
export const UNSUPPORTED_LEGACY_WORD_MESSAGE = 'Legacy Word .doc files are not supported. Please upload this resume as DOCX or text-based PDF.'

const OLE_COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function normalizeMimeType(value) {
  return String(value || '').trim().toLowerCase()
}

function getFileExtension(filename) {
  const normalizedFilename = String(filename || '').trim()
  const lastDotIndex = normalizedFilename.lastIndexOf('.')
  if (lastDotIndex <= 0 || lastDotIndex === normalizedFilename.length - 1) {
    return ''
  }
  return normalizedFilename.slice(lastDotIndex + 1).toLowerCase()
}

export function hasOleCompoundFileMagic(fileBuffer) {
  return Buffer.isBuffer(fileBuffer)
    && fileBuffer.length >= OLE_COMPOUND_FILE_MAGIC.length
    && OLE_COMPOUND_FILE_MAGIC.every((byte, index) => fileBuffer[index] === byte)
}

export function getLegacyWordDocumentDetection({ filename, mimeType, originalMimeType, fileBuffer } = {}) {
  const extension = getFileExtension(filename)
  const normalizedMimeType = normalizeMimeType(mimeType)
  const normalizedOriginalMimeType = normalizeMimeType(originalMimeType)
  const mimeTypes = [normalizedMimeType, normalizedOriginalMimeType].filter(Boolean)
  const uniqueMimeTypes = [...new Set(mimeTypes)]
  const hasDocExtension = extension === 'doc'
  const hasDocxExtension = extension === 'docx'
  const hasLegacyMimeType = uniqueMimeTypes.includes(LEGACY_WORD_MIME_TYPE)
  const hasDocxMimeType = uniqueMimeTypes.includes(DOCX_MIME_TYPE)
  const hasOleMagic = hasOleCompoundFileMagic(fileBuffer)
  const hasMismatch = Boolean(
    (hasDocExtension && hasDocxMimeType)
      || (hasDocxExtension && (hasLegacyMimeType || hasOleMagic))
      || (hasLegacyMimeType && hasDocxMimeType),
  )

  return {
    isLegacyWordDocument: Boolean(hasDocExtension || hasLegacyMimeType || hasOleMagic),
    extension,
    hasDocExtension,
    hasDocxExtension,
    hasLegacyMimeType,
    hasDocxMimeType,
    hasOleMagic,
    hasMismatch,
    mimeTypes: uniqueMimeTypes,
  }
}

export function createUnsupportedLegacyWordError({ detection = null } = {}) {
  const error = new Error(`${UNSUPPORTED_LEGACY_WORD_CATEGORY}::${UNSUPPORTED_LEGACY_WORD_MESSAGE}`)
  error.category = UNSUPPORTED_LEGACY_WORD_CATEGORY
  error.extractionCategory = UNSUPPORTED_LEGACY_WORD_CATEGORY
  error.nonRetriable = true
  if (detection) {
    error.diagnostics = {
      extension: detection.extension || null,
      hasDocExtension: Boolean(detection.hasDocExtension),
      hasDocxExtension: Boolean(detection.hasDocxExtension),
      hasLegacyMimeType: Boolean(detection.hasLegacyMimeType),
      hasDocxMimeType: Boolean(detection.hasDocxMimeType),
      hasOleMagic: Boolean(detection.hasOleMagic),
      hasMismatch: Boolean(detection.hasMismatch),
      mimeTypes: detection.mimeTypes || [],
    }
  }
  return error
}
