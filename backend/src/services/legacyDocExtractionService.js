import { Buffer } from 'node:buffer'
import process from 'node:process'

const LEGACY_DOC_EXTRACTION_FAILURE_CATEGORY = 'legacy_doc_extraction_failed'
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const MAX_ERROR_DETAIL_LENGTH = 120
const MIN_TEXT_RUN_LENGTH = 4
const DEFAULT_MAX_LEGACY_DOC_BYTES = 5 * 1024 * 1024
const DEFAULT_EXTRACTION_TIMEOUT_MS = 2000
const LOOP_DEADLINE_CHECK_INTERVAL = 8192
const NULL_CHARACTER = String.fromCharCode(0)

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
}

export function getLegacyDocExtractionLimits(env = process.env) {
  return {
    maxBytes: normalizePositiveInteger(env?.LEGACY_DOC_EXTRACTION_MAX_BYTES, DEFAULT_MAX_LEGACY_DOC_BYTES),
    timeoutMs: normalizePositiveInteger(env?.LEGACY_DOC_EXTRACTION_TIMEOUT_MS, DEFAULT_EXTRACTION_TIMEOUT_MS),
  }
}

function createDeadline(timeoutMs) {
  return Date.now() + timeoutMs
}

function assertNotPastDeadline(deadline) {
  if (Date.now() > deadline) {
    throw createLegacyDocExtractionError('extraction_timeout')
  }
}

function normalizeFeatureFlag(value) {
  return String(value || '').trim().toLowerCase()
}

export function isLegacyDocExtractionEnabled(env = process.env) {
  return TRUE_VALUES.has(normalizeFeatureFlag(env?.ENABLE_LEGACY_DOC_EXTRACTION))
}

function sanitizeErrorDetail(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (normalized || 'unknown').slice(0, MAX_ERROR_DETAIL_LENGTH)
}

export function createLegacyDocExtractionError(detail = 'failed', { cause = null, diagnostics = null } = {}) {
  const error = new Error(`${LEGACY_DOC_EXTRACTION_FAILURE_CATEGORY}::${sanitizeErrorDetail(detail)}`, cause ? { cause } : undefined)
  error.category = LEGACY_DOC_EXTRACTION_FAILURE_CATEGORY
  error.extractionCategory = LEGACY_DOC_EXTRACTION_FAILURE_CATEGORY
  error.nonRetriable = true
  if (diagnostics) {
    error.diagnostics = diagnostics
  }
  return error
}

function isAsciiTextByte(byte) {
  return byte === 0x09
    || byte === 0x0a
    || byte === 0x0d
    || (byte >= 0x20 && byte <= 0x7e)
}

function pushRun(runs, chars) {
  const text = chars.join('').trim()
  if (text.length >= MIN_TEXT_RUN_LENGTH) {
    runs.push(text)
  }
}

function extractAsciiRuns(fileBuffer, deadline) {
  const runs = []
  let chars = []

  for (let offset = 0; offset < fileBuffer.length; offset += 1) {
    if (offset % LOOP_DEADLINE_CHECK_INTERVAL === 0) assertNotPastDeadline(deadline)
    const byte = fileBuffer[offset]
    if (isAsciiTextByte(byte)) {
      chars.push(String.fromCharCode(byte))
    } else {
      pushRun(runs, chars)
      chars = []
    }
  }
  pushRun(runs, chars)

  return runs
}

function extractUtf16LeRuns(fileBuffer, deadline) {
  const runs = []
  let chars = []

  for (let index = 0; index < fileBuffer.length - 1; index += 2) {
    if (index % LOOP_DEADLINE_CHECK_INTERVAL === 0) assertNotPastDeadline(deadline)
    const byte = fileBuffer[index]
    const highByte = fileBuffer[index + 1]
    if (highByte === 0x00 && isAsciiTextByte(byte)) {
      chars.push(String.fromCharCode(byte))
    } else {
      pushRun(runs, chars)
      chars = []
    }
  }
  pushRun(runs, chars)

  return runs
}

function normalizeExtractedTextRuns(runs) {
  const seen = new Set()
  const normalizedRuns = []

  for (const run of runs) {
    const normalizedRun = String(run || '')
      .normalize('NFKC')
      .split(NULL_CHARACTER).join(' ')
      .split('')
      .map((char) => {
        const codePoint = char.codePointAt(0)
        return (codePoint > 0 && codePoint < 32 && ![9, 10, 13].includes(codePoint)) || codePoint === 127 ? ' ' : char
      })
      .join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
      .trim()

    if (!normalizedRun || seen.has(normalizedRun)) {
      continue
    }
    seen.add(normalizedRun)
    normalizedRuns.push(normalizedRun)
  }

  return normalizedRuns.join('\n').trim()
}


function getFileExtension(filename) {
  const normalizedFilename = String(filename || '').trim()
  const lastDotIndex = normalizedFilename.lastIndexOf('.')
  if (lastDotIndex <= 0 || lastDotIndex === normalizedFilename.length - 1) {
    return ''
  }
  return normalizedFilename.slice(lastDotIndex + 1).toLowerCase()
}

function buildLegacyDocDiagnostics({ fileBuffer, filename = null, mimeType = null, originalMimeType = null, extractedText = '', errorCategory = null } = {}) {
  return {
    filenameExtension: getFileExtension(filename) || null,
    mimeType: mimeType || null,
    originalMimeType: originalMimeType || null,
    decodedBufferByteLength: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0,
    extractedTextCharCount: String(extractedText || '').length,
    errorCategory: errorCategory || null,
  }
}

export async function extractTextFromLegacyDocBuffer(fileBuffer, options = {}) {
  const { filename = 'resume.doc', mimeType = null, originalMimeType = null, logger = console } = options || {}
  const limits = getLegacyDocExtractionLimits(options?.env || process.env)
  const deadline = createDeadline(limits.timeoutMs)

  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw createLegacyDocExtractionError('invalid_input_buffer', {
      diagnostics: buildLegacyDocDiagnostics({ fileBuffer, filename, mimeType, originalMimeType, errorCategory: 'invalid_input_buffer' }),
    })
  }

  if (fileBuffer.length > limits.maxBytes) {
    throw createLegacyDocExtractionError('file_too_large', {
      diagnostics: buildLegacyDocDiagnostics({ fileBuffer, filename, mimeType, originalMimeType, errorCategory: 'file_too_large' }),
    })
  }

  const extractedText = normalizeExtractedTextRuns([
    ...extractUtf16LeRuns(fileBuffer, deadline),
    ...extractAsciiRuns(fileBuffer, deadline),
  ])

  const diagnostics = buildLegacyDocDiagnostics({ fileBuffer, filename, mimeType, originalMimeType, extractedText })
  logger?.debug?.('[ResumeExtraction] Legacy DOC local text extraction diagnostics', diagnostics)

  if (!extractedText) {
    throw createLegacyDocExtractionError('empty_extracted_text', {
      diagnostics: buildLegacyDocDiagnostics({
        fileBuffer,
        filename,
        mimeType,
        originalMimeType,
        extractedText,
        errorCategory: 'empty_extracted_text',
      }),
    })
  }

  return extractedText
}
