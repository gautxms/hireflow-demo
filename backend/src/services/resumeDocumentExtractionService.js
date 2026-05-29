import { createHash } from 'crypto'

let mammothClient = null

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOCX_DOCUMENT_XML_PATH = 'word/document.xml'
const TEXT_FINGERPRINT_VERSION = 'resume-text-fingerprint-v1'


export function normalizeResumeTextForFingerprint(text = '') {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\u0000/g, ' ')
    .replace(/\uFFFD/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim().toLowerCase())
    .filter(Boolean)
    .filter((line) => !/^page\s+\d+(\s+of\s+\d+)?$/i.test(line))
    .filter((line) => !/^(confidential|curriculum vitae|resume)$/i.test(line))
    .join('\n')
}

export function buildResumeTextFingerprint(text = '') {
  const normalizedText = normalizeResumeTextForFingerprint(text)
  if (!normalizedText) {
    return {
      version: TEXT_FINGERPRINT_VERSION,
      comparable: false,
      reason: 'empty_normalized_text',
      normalizedCharCount: 0,
      normalizedLineCount: 0,
      sha256: null,
    }
  }

  return {
    version: TEXT_FINGERPRINT_VERSION,
    comparable: true,
    reason: null,
    normalizedCharCount: normalizedText.length,
    normalizedLineCount: normalizedText.split('\n').length,
    sha256: createHash('sha256').update(normalizedText).digest('hex'),
  }
}

export function compareResumeTextFingerprints(leftText = '', rightText = '') {
  const left = buildResumeTextFingerprint(leftText)
  const right = buildResumeTextFingerprint(rightText)
  return {
    comparable: Boolean(left.comparable && right.comparable),
    equivalent: Boolean(left.comparable && right.comparable && left.sha256 === right.sha256),
    left,
    right,
    charCountDelta: Math.abs(Number(left.normalizedCharCount || 0) - Number(right.normalizedCharCount || 0)),
    lineCountDelta: Math.abs(Number(left.normalizedLineCount || 0) - Number(right.normalizedLineCount || 0)),
  }
}

function buildPreparedPayloadDiagnostics({
  sourceFormat,
  inputKind,
  inputMode,
  preparedMimeType,
  originalMimeType,
  extractedText = null,
  extractionMethod = null,
  fallbackUsed = false,
  fallbackReason = null,
}) {
  const text = String(extractedText || '')
  const fingerprint = text ? buildResumeTextFingerprint(text) : null
  return {
    sourceFormat: sourceFormat || 'unknown',
    inputKind: inputKind || null,
    inputMode: inputMode || null,
    preparedMimeType: preparedMimeType || null,
    originalMimeType: originalMimeType || null,
    extractionMethod: extractionMethod || null,
    extractedTextCharCount: text.length,
    normalizedTextCharCount: fingerprint?.normalizedCharCount || 0,
    normalizedTextLineCount: fingerprint?.normalizedLineCount || 0,
    normalizedTextFingerprint: fingerprint?.sha256 || null,
    fallbackUsed: Boolean(fallbackUsed),
    fallbackReason: fallbackReason || null,
  }
}

function createDocxExtractionError(category, message, { cause = null, diagnostics = null } = {}) {
  const error = new Error(`${category}::${message}`, cause ? { cause } : undefined)
  error.category = category
  error.extractionCategory = category
  if (diagnostics) {
    error.diagnostics = diagnostics
  }
  return error
}

function getErrorCategory(error) {
  const message = String(error?.message || '')
  const prefixedCategory = message.match(/^([a-z0-9_]+)::/i)?.[1]
  return error?.category || error?.extractionCategory || prefixedCategory || 'unknown'
}

async function getMammothClient() {
  if (mammothClient) {
    return mammothClient
  }

  try {
    const mammothModule = await import('mammoth')
    mammothClient = mammothModule?.default || mammothModule
    return mammothClient
  } catch (error) {
    throw createDocxExtractionError(
      'docx_dependency_missing',
      'DOCX parsing dependency is unavailable. Please reinstall dependencies.',
      { cause: error },
    )
  }
}

function decodeBase64ToBuffer(fileBufferBase64) {
  return Buffer.from(String(fileBufferBase64 || ''), 'base64')
}

function hasDocxZipMagic(fileBuffer) {
  return Buffer.isBuffer(fileBuffer)
    && fileBuffer.length >= 4
    && fileBuffer[0] === 0x50
    && fileBuffer[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(fileBuffer[2])
    && [0x04, 0x06, 0x08].includes(fileBuffer[3])
}

function zipContainsEntry(fileBuffer, entryPath) {
  if (!Buffer.isBuffer(fileBuffer) || !entryPath) return false
  return fileBuffer.includes(Buffer.from(entryPath, 'utf8'))
}

function buildDocxDiagnostics({
  filename,
  mimeType,
  originalMimeType,
  fileSize,
  fileBuffer,
  mammothTextLength = null,
  errorCategory = null,
}) {
  return {
    filename: filename || null,
    mimeType: mimeType || null,
    originalMimeType: originalMimeType || null,
    declaredFileSize: Number.isFinite(Number(fileSize)) ? Number(fileSize) : null,
    decodedBufferByteLength: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0,
    hasDocxZipMagic: hasDocxZipMagic(fileBuffer),
    hasWordDocumentXml: zipContainsEntry(fileBuffer, DOCX_DOCUMENT_XML_PATH),
    mammothTextLength: Number.isFinite(Number(mammothTextLength)) ? Number(mammothTextLength) : null,
    errorCategory: errorCategory || null,
  }
}

function logDocxDiagnostics(logger, diagnostics, level = 'warn') {
  const target = logger?.[level] || logger?.warn || logger?.log
  if (typeof target === 'function') {
    target.call(logger, '[ResumeExtraction] DOCX extraction diagnostics', diagnostics)
  }
}

export function inspectDocxBuffer(fileBuffer, metadata = {}) {
  return buildDocxDiagnostics({ ...metadata, fileBuffer })
}

export async function extractTextFromDocxBuffer(fileBuffer, filename = 'resume.docx', options = {}) {
  const {
    mimeType = DOCX_MIME_TYPE,
    originalMimeType = mimeType,
    fileSize = null,
    logger = console,
  } = options || {}
  let mammothTextLength = null

  const buildDiagnostics = (errorCategory = null) => buildDocxDiagnostics({
    filename,
    mimeType,
    originalMimeType,
    fileSize,
    fileBuffer,
    mammothTextLength,
    errorCategory,
  })

  if (!hasDocxZipMagic(fileBuffer) || !zipContainsEntry(fileBuffer, DOCX_DOCUMENT_XML_PATH)) {
    const diagnostics = buildDiagnostics('docx_invalid_or_unreadable')
    logDocxDiagnostics(logger, diagnostics)
    throw createDocxExtractionError(
      'docx_invalid_or_unreadable',
      `Unable to read DOCX file ${filename}. Please upload a valid .docx file or PDF.`,
      { diagnostics },
    )
  }

  try {
    const mammoth = await getMammothClient()
    const { value } = await mammoth.extractRawText({ buffer: fileBuffer })
    const extractedText = String(value || '').trim()
    mammothTextLength = extractedText.length
    if (!extractedText) {
      const diagnostics = buildDiagnostics('docx_empty_extraction')
      logDocxDiagnostics(logger, diagnostics)
      throw createDocxExtractionError(
        'docx_empty_extraction',
        `Unable to extract readable text from DOCX file ${filename}. Please confirm it contains selectable text or upload PDF.`,
        { diagnostics },
      )
    }
    logDocxDiagnostics(logger, buildDiagnostics(null), 'debug')
    return extractedText
  } catch (error) {
    const category = getErrorCategory(error)
    if (category === 'docx_empty_extraction' || category === 'docx_dependency_missing') {
      if (category === 'docx_dependency_missing') {
        const diagnostics = buildDiagnostics(category)
        logDocxDiagnostics(logger, diagnostics)
        error.diagnostics = error.diagnostics || diagnostics
      }
      throw error
    }

    const diagnostics = buildDiagnostics('docx_extraction_failed')
    logDocxDiagnostics(logger, diagnostics)
    throw createDocxExtractionError(
      'docx_extraction_failed',
      `Unable to extract text from DOCX file ${filename}. Please upload PDF or try saving the document as .docx again.`,
      { cause: error, diagnostics },
    )
  }
}

export async function prepareResumePayloadForAnalysis({ fileBufferBase64, mimeType, filename, fileSize, logger = console }) {
  const normalizedMimeType = String(mimeType || '').toLowerCase().trim()
  const normalizedFilename = String(filename || '').trim()
  const lowerFilename = normalizedFilename.toLowerCase()

  if (lowerFilename.endsWith('.doc')) {
    throw new Error(`legacy_word_format::Legacy .doc files are not supported for ${normalizedFilename || 'uploaded file'}. Please upload .docx or PDF.`)
  }

  const buildBase = () => ({
    originalFilename: normalizedFilename || null,
    originalMimeType: normalizedMimeType || null,
    extractionWarnings: [],
  })

  if (normalizedMimeType === 'text/plain') {
    const extractedText = Buffer.from(String(fileBufferBase64 || ''), 'base64').toString('utf8').trim()
    const sourceFormat = lowerFilename.endsWith('.txt') ? 'txt' : 'unknown'
    return {
      ...buildBase(),
      fileBufferBase64,
      mimeType: 'text/plain',
      preparedMimeType: 'text/plain',
      sourceFormat,
      inputKind: 'extracted_text',
      inputMode: 'extracted_text',
      extractedText,
      base64File: null,
      diagnostics: buildPreparedPayloadDiagnostics({
        sourceFormat,
        inputKind: 'extracted_text',
        inputMode: 'extracted_text',
        preparedMimeType: 'text/plain',
        originalMimeType: normalizedMimeType || null,
        extractedText,
        extractionMethod: 'uploaded_text',
      }),
    }
  }

  if (normalizedMimeType === 'application/pdf') {
    return {
      ...buildBase(),
      fileBufferBase64,
      mimeType,
      preparedMimeType: normalizedMimeType,
      sourceFormat: 'pdf',
      inputKind: 'pdf_binary',
      inputMode: 'binary',
      extractedText: null,
      base64File: fileBufferBase64,
      diagnostics: buildPreparedPayloadDiagnostics({
        sourceFormat: 'pdf',
        inputKind: 'pdf_binary',
        inputMode: 'binary',
        preparedMimeType: normalizedMimeType,
        originalMimeType: normalizedMimeType || null,
        extractionMethod: 'provider_pdf_binary',
        fallbackUsed: false,
      }),
    }
  }

  if (normalizedMimeType === DOCX_MIME_TYPE || lowerFilename.endsWith('.docx')) {
    const fileBuffer = decodeBase64ToBuffer(fileBufferBase64)
    const extractedText = await extractTextFromDocxBuffer(fileBuffer, normalizedFilename || 'resume.docx', {
      mimeType: normalizedMimeType || mimeType || DOCX_MIME_TYPE,
      originalMimeType: normalizedMimeType || mimeType || null,
      fileSize,
      logger,
    })
    return {
      ...buildBase(),
      fileBufferBase64: Buffer.from(extractedText, 'utf8').toString('base64'),
      mimeType: 'text/plain',
      preparedMimeType: 'text/plain',
      sourceFormat: lowerFilename.endsWith('.docx') ? 'docx' : 'unknown',
      inputKind: 'extracted_text',
      inputMode: 'extracted_text',
      extractedText,
      base64File: null,
      diagnostics: buildPreparedPayloadDiagnostics({
        sourceFormat: lowerFilename.endsWith('.docx') ? 'docx' : 'unknown',
        inputKind: 'extracted_text',
        inputMode: 'extracted_text',
        preparedMimeType: 'text/plain',
        originalMimeType: normalizedMimeType || mimeType || null,
        extractedText,
        extractionMethod: 'mammoth_raw_text',
      }),
    }
  }

  return {
    ...buildBase(),
    fileBufferBase64,
    mimeType,
    preparedMimeType: normalizedMimeType || mimeType,
    sourceFormat: 'unknown',
    inputKind: 'binary_unknown',
    inputMode: 'binary',
    extractedText: null,
    base64File: fileBufferBase64,
    diagnostics: buildPreparedPayloadDiagnostics({
      sourceFormat: 'unknown',
      inputKind: 'binary_unknown',
      inputMode: 'binary',
      preparedMimeType: normalizedMimeType || mimeType,
      originalMimeType: normalizedMimeType || null,
      extractionMethod: 'provider_binary_unknown',
    }),
  }
}
