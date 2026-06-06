import { Buffer } from 'node:buffer'
import { createHash } from 'crypto'
import {
  buildResumeTextFingerprint,
  compareResumeTextFingerprints,
  normalizeResumeTextForFingerprint,
} from './resumeTextFingerprint.js'
import {
  createUnsupportedLegacyWordError,
  getLegacyWordDocumentDetection,
  DOCX_MIME_TYPE,
} from '../utils/legacyWordDocument.js'
import {
  createLegacyDocExtractionError,
  extractTextFromLegacyDocBuffer,
  isLegacyDocExtractionEnabled,
} from './legacyDocExtractionService.js'
import {
  isPdfCanonicalExtractionObserveOnlyEnabled,
  observePdfCanonicalTextExtraction,
  logSafePdfCanonicalExtractionDiagnostics,
} from './pdfCanonicalExtractionService.js'

let mammothClient = null
let mammothClientOverrideForTests = undefined

const DOCX_DOCUMENT_XML_PATH = 'word/document.xml'
const PDF_MAGIC = Buffer.from('%PDF', 'ascii')
const ZIP_LOCAL_FILE_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const ZIP_EMPTY_ARCHIVE_MAGIC = [0x50, 0x4b, 0x05, 0x06]
const ZIP_SPANNED_ARCHIVE_MAGIC = [0x50, 0x4b, 0x07, 0x08]
const OLE_COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

export {
  buildResumeTextFingerprint,
  compareResumeTextFingerprints,
  normalizeResumeTextForFingerprint,
}

function normalizeMimeType(value) {
  return String(value || '').trim().toLowerCase()
}

function getFileExtensionFromFilename(filename) {
  const normalizedFilename = String(filename || '').trim()
  const lastDotIndex = normalizedFilename.lastIndexOf('.')
  if (lastDotIndex <= 0 || lastDotIndex === normalizedFilename.length - 1) {
    return ''
  }
  return normalizedFilename.slice(lastDotIndex + 1).toLowerCase()
}

function bufferStartsWith(fileBuffer, signature) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < signature.length) return false
  return signature.every((byte, index) => fileBuffer[index] === byte)
}

function hasPdfMagic(fileBuffer) {
  return Buffer.isBuffer(fileBuffer) && fileBuffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
}

function hasZipMagic(fileBuffer) {
  return bufferStartsWith(fileBuffer, ZIP_LOCAL_FILE_MAGIC)
    || bufferStartsWith(fileBuffer, ZIP_EMPTY_ARCHIVE_MAGIC)
    || bufferStartsWith(fileBuffer, ZIP_SPANNED_ARCHIVE_MAGIC)
}

function hasOleMagic(fileBuffer) {
  return bufferStartsWith(fileBuffer, OLE_COMPOUND_FILE_MAGIC)
}

export function classifyResumeFileMagic(fileBuffer) {
  const hasWordDocumentXml = zipContainsEntry(fileBuffer, DOCX_DOCUMENT_XML_PATH)

  if (hasPdfMagic(fileBuffer)) {
    return { classification: 'pdf', hasWordDocumentXml: false }
  }

  if (hasZipMagic(fileBuffer) && hasWordDocumentXml) {
    return { classification: 'docx_zip', hasWordDocumentXml }
  }

  if (hasOleMagic(fileBuffer)) {
    return { classification: 'legacy_doc_ole', hasWordDocumentXml: false }
  }

  return { classification: 'unknown', hasWordDocumentXml: Boolean(hasWordDocumentXml) }
}


function buildNonReversibleFingerprint(value, namespace) {
  const normalizedValue = Buffer.isBuffer(value)
    ? value
    : String(value || '').trim().normalize('NFKC')
  const isEmptyBuffer = Buffer.isBuffer(normalizedValue) && normalizedValue.length === 0
  const isEmptyString = !Buffer.isBuffer(normalizedValue) && !normalizedValue
  if (isEmptyBuffer || isEmptyString) {
    return null
  }

  return createHash('sha256')
    .update(`${namespace}:`)
    .update(normalizedValue)
    .digest('hex')
    .slice(0, 16)
}

function buildFilenameFingerprint(filename) {
  return buildNonReversibleFingerprint(filename, 'resume-filename-fingerprint-v1')
}

function buildFileContentFingerprint(fileBuffer) {
  return Buffer.isBuffer(fileBuffer)
    ? buildNonReversibleFingerprint(fileBuffer, 'resume-file-content-fingerprint-v1')
    : null
}

function buildSafeFilenameDiagnostics(filename) {
  const normalizedFilename = String(filename || '').trim()
  return {
    extension: getFileExtensionFromFilename(normalizedFilename) || null,
    fingerprint: buildFilenameFingerprint(normalizedFilename),
  }
}

function normalizeFileSize(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function buildSafeResumeFileDiagnostics({
  resumeId = null,
  analysisId = null,
  parseJobId = null,
  originalFilename = null,
  displayFilename = null,
  filename = null,
  mimeType = null,
  originalMimeType = null,
  normalizedMimeType = null,
  fileSize = null,
  fileBuffer = null,
  extension = null,
  extractionMethod = null,
  extractedTextCharCount = null,
  preparedMimeType = null,
  inputKind = null,
} = {}) {
  const resolvedOriginalFilename = String(originalFilename || filename || '').trim() || null
  const resolvedDisplayFilename = String(displayFilename || '').trim() || null
  const originalFilenameDiagnostics = buildSafeFilenameDiagnostics(resolvedOriginalFilename)
  const displayFilenameDiagnostics = buildSafeFilenameDiagnostics(resolvedDisplayFilename)
  const resolvedNormalizedMimeType = normalizeMimeType(normalizedMimeType || mimeType) || null
  const magic = classifyResumeFileMagic(fileBuffer)
  const decodedBufferByteLength = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0
  const resolvedExtension = String(extension || originalFilenameDiagnostics.extension || displayFilenameDiagnostics.extension || '').trim().toLowerCase() || null
  const numericTextCount = extractedTextCharCount === null || extractedTextCharCount === undefined
    ? null
    : Number(extractedTextCharCount)

  return {
    resumeId: resumeId || null,
    analysisId: analysisId || null,
    parseJobId: parseJobId ? String(parseJobId) : null,
    originalFilenameFingerprint: originalFilenameDiagnostics.fingerprint,
    displayFilenameFingerprint: resolvedDisplayFilename && resolvedDisplayFilename !== resolvedOriginalFilename
      ? displayFilenameDiagnostics.fingerprint
      : null,
    fileContentFingerprint: buildFileContentFingerprint(fileBuffer),
    uploadMimeType: normalizeMimeType(originalMimeType || mimeType) || null,
    normalizedMimeType: resolvedNormalizedMimeType,
    uploadFileSize: normalizeFileSize(fileSize),
    decodedBufferByteLength,
    extension: resolvedExtension,
    fileSignature: magic.classification,
    hasWordDocumentXml: magic.hasWordDocumentXml,
    extractionMethod: extractionMethod || null,
    extractedTextCharCount: Number.isFinite(numericTextCount) ? numericTextCount : null,
    preparedMimeType: preparedMimeType || null,
    inputKind: inputKind || null,
  }
}

function compactResumeFileDiagnostics(diagnostics = {}) {
  const originalFilenameDiagnostics = buildSafeFilenameDiagnostics(diagnostics.originalFilename)
  const displayFilenameDiagnostics = buildSafeFilenameDiagnostics(diagnostics.displayFilename)

  return {
    resumeId: diagnostics.resumeId || null,
    analysisId: diagnostics.analysisId || null,
    parseJobId: diagnostics.parseJobId || null,
    originalFilenameFingerprint: diagnostics.originalFilenameFingerprint || originalFilenameDiagnostics.fingerprint || null,
    displayFilenameFingerprint: diagnostics.displayFilenameFingerprint || displayFilenameDiagnostics.fingerprint || null,
    fileContentFingerprint: diagnostics.fileContentFingerprint || null,
    uploadMimeType: diagnostics.uploadMimeType || diagnostics.originalMimeType || null,
    normalizedMimeType: diagnostics.normalizedMimeType || null,
    uploadFileSize: diagnostics.uploadFileSize ?? diagnostics.declaredFileSize ?? null,
    decodedBufferByteLength: diagnostics.decodedBufferByteLength ?? null,
    extension: diagnostics.extension || originalFilenameDiagnostics.extension || displayFilenameDiagnostics.extension || null,
    fileSignature: diagnostics.fileSignature || null,
    hasWordDocumentXml: diagnostics.hasWordDocumentXml ?? null,
    extractionMethod: diagnostics.extractionMethod || null,
    extractedTextCharCount: diagnostics.extractedTextCharCount ?? null,
    preparedMimeType: diagnostics.preparedMimeType || null,
    inputKind: diagnostics.inputKind || null,
  }
}

export function logSafeResumeFileDiagnostics(logger, event, diagnostics, level = 'info') {
  const target = logger?.[level] || logger?.log
  if (typeof target === 'function') {
    target.call(logger, `[ResumeDiagnostics] ${event}`, compactResumeFileDiagnostics(diagnostics))
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

function buildSafeErrorCauseDiagnostics(error) {
  if (!error) return null
  const message = String(error?.message || '').trim()
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    code: error?.code ? String(error.code).slice(0, 80) : null,
    messageFingerprint: message ? buildNonReversibleFingerprint(message, 'resume-extraction-error-message-v1') : null,
  }
}

function getErrorCategory(error) {
  const message = String(error?.message || '')
  const prefixedCategory = message.match(/^([a-z0-9_]+)::/i)?.[1]
  return error?.category || error?.extractionCategory || prefixedCategory || 'unknown'
}

export function __setMammothClientForTests(client) {
  mammothClientOverrideForTests = client
}

export function __resetMammothClientForTests() {
  mammothClientOverrideForTests = undefined
  mammothClient = null
}

async function getMammothClient() {
  if (mammothClientOverrideForTests !== undefined) {
    if (!mammothClientOverrideForTests) {
      throw createDocxExtractionError(
        'docx_dependency_missing',
        'DOCX parsing dependency is unavailable. Please reinstall dependencies.',
      )
    }
    return mammothClientOverrideForTests
  }

  if (mammothClient) {
    return mammothClient
  }

  try {
    const mammothModule = await import('mammoth')
    mammothClient = mammothModule?.default || mammothModule
    if (!mammothClient || typeof mammothClient.extractRawText !== 'function') {
      throw new Error('mammoth_extract_raw_text_unavailable')
    }
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
  cause = null,
}) {
  const filenameDiagnostics = buildSafeFilenameDiagnostics(filename)

  return {
    filenameExtension: filenameDiagnostics.extension,
    filenameFingerprint: filenameDiagnostics.fingerprint,
    mimeType: mimeType || null,
    originalMimeType: originalMimeType || null,
    declaredFileSize: Number.isFinite(Number(fileSize)) ? Number(fileSize) : null,
    decodedBufferByteLength: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0,
    hasDocxZipMagic: hasDocxZipMagic(fileBuffer),
    hasWordDocumentXml: zipContainsEntry(fileBuffer, DOCX_DOCUMENT_XML_PATH),
    mammothTextLength: Number.isFinite(Number(mammothTextLength)) ? Number(mammothTextLength) : null,
    errorCategory: errorCategory || null,
    cause: buildSafeErrorCauseDiagnostics(cause),
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

  const buildDiagnostics = (errorCategory = null, cause = null) => buildDocxDiagnostics({
    filename,
    mimeType,
    originalMimeType,
    fileSize,
    fileBuffer,
    mammothTextLength,
    errorCategory,
    cause,
  })

  if (hasOleMagic(fileBuffer)) {
    throw createUnsupportedLegacyWordError({ detection: getLegacyWordDocumentDetection({
      filename,
      mimeType,
      originalMimeType,
      fileBuffer,
    }) })
  }

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
    if (!mammoth || typeof mammoth.extractRawText !== 'function') {
      throw createDocxExtractionError(
        'docx_dependency_missing',
        'DOCX parsing dependency is unavailable. Please reinstall dependencies.',
      )
    }
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
        const diagnostics = buildDiagnostics(category, error?.cause || error)
        logDocxDiagnostics(logger, diagnostics)
        error.diagnostics = error.diagnostics || diagnostics
      }
      throw error
    }

    const invalidDocxPattern = /(end of central directory|corrupt|invalid zip|not a zip|can't find|cannot find|missing .*document\.xml|file not found|no such file|unrecognized archive|bad archive)/i
    if (invalidDocxPattern.test(String(error?.message || ''))) {
      const diagnostics = buildDiagnostics('docx_invalid_or_unreadable', error)
      logDocxDiagnostics(logger, diagnostics)
      throw createDocxExtractionError(
        'docx_invalid_or_unreadable',
        `Unable to read DOCX file ${filename}. Please upload a valid .docx file or PDF.`,
        { cause: error, diagnostics },
      )
    }

    const diagnostics = buildDiagnostics('docx_extraction_failed', error)
    logDocxDiagnostics(logger, diagnostics)
    throw createDocxExtractionError(
      'docx_extraction_failed',
      `Unable to extract text from DOCX file ${filename}. Please upload PDF or try saving the document as .docx again.`,
      { cause: error, diagnostics },
    )
  }
}

export async function prepareResumePayloadForAnalysis({ fileBufferBase64, mimeType, originalMimeType, filename, displayFilename = null, fileSize, logger = console, diagnosticsContext = {} }) {
  const normalizedMimeType = String(mimeType || '').toLowerCase().trim()
  const normalizedOriginalMimeType = String(originalMimeType || mimeType || '').toLowerCase().trim()
  const normalizedFilename = String(filename || '').trim()
  const lowerFilename = normalizedFilename.toLowerCase()
  const fileBuffer = decodeBase64ToBuffer(fileBufferBase64)
  const baseDiagnosticsInput = {
    resumeId: diagnosticsContext?.resumeId || null,
    analysisId: diagnosticsContext?.analysisId || null,
    parseJobId: diagnosticsContext?.parseJobId || null,
    originalFilename: normalizedFilename || null,
    displayFilename,
    mimeType,
    originalMimeType: normalizedOriginalMimeType || originalMimeType || mimeType || null,
    normalizedMimeType,
    fileSize,
    fileBuffer,
    extension: diagnosticsContext?.fileExtension || null,
  }

  logSafeResumeFileDiagnostics(
    logger,
    'parse_job_input',
    buildSafeResumeFileDiagnostics(baseDiagnosticsInput),
  )
  const legacyWordDetection = getLegacyWordDocumentDetection({
    filename: normalizedFilename,
    mimeType: normalizedMimeType,
    originalMimeType: normalizedOriginalMimeType,
    fileBuffer,
  })

  const mergeSafeDiagnostics = (diagnostics, { extractionMethod, extractedTextCharCount = null, preparedMimeType = null, inputKind = null } = {}) => ({
    ...(diagnostics || {}),
    ...buildSafeResumeFileDiagnostics({
      ...baseDiagnosticsInput,
      extractionMethod,
      extractedTextCharCount,
      preparedMimeType,
      inputKind,
    }),
  })


  const buildBase = () => ({
    originalFilename: normalizedFilename || null,
    originalMimeType: normalizedOriginalMimeType || normalizedMimeType || null,
    extractionWarnings: [],
  })

  if (legacyWordDetection.isLegacyWordDocument) {
    if (legacyWordDetection.hasMismatch) {
      const filenameDiagnostics = buildSafeFilenameDiagnostics(normalizedFilename)
      logger?.warn?.('[ResumeExtraction] Legacy Word MIME/extension mismatch handled before DOCX extraction', {
        filenameExtension: filenameDiagnostics.extension,
        filenameFingerprint: filenameDiagnostics.fingerprint,
        mimeType: normalizedMimeType || null,
        originalMimeType: normalizedOriginalMimeType || null,
        extension: legacyWordDetection.extension || null,
        hasOleMagic: legacyWordDetection.hasOleMagic,
      })
    }

    if (!isLegacyDocExtractionEnabled()) {
      const error = createUnsupportedLegacyWordError({ detection: legacyWordDetection })
      error.diagnostics = {
        ...(error.diagnostics || {}),
        ...buildSafeResumeFileDiagnostics({
          ...baseDiagnosticsInput,
          extractionMethod: 'legacy_doc_rejected',
          preparedMimeType: null,
          inputKind: null,
          extractedTextCharCount: 0,
        }),
      }
      logSafeResumeFileDiagnostics(logger, 'extraction_decision', error.diagnostics, 'warn')
      throw error
    }

    let extractedText
    try {
      extractedText = await extractTextFromLegacyDocBuffer(fileBuffer, {
        filename: normalizedFilename || 'resume.doc',
        mimeType: normalizedMimeType || mimeType || 'application/msword',
        originalMimeType: normalizedOriginalMimeType || normalizedMimeType || mimeType || null,
        logger,
      })
    } catch (error) {
      const wrappedError = error?.extractionCategory === 'legacy_doc_extraction_failed'
        ? error
        : createLegacyDocExtractionError(error?.message || 'failed', { cause: error })
      wrappedError.diagnostics = mergeSafeDiagnostics(wrappedError.diagnostics || {}, {
        extractionMethod: 'legacy_doc_text_extraction',
        extractedTextCharCount: wrappedError?.diagnostics?.extractedTextCharCount ?? 0,
        preparedMimeType: null,
        inputKind: 'extracted_text',
      })
      logSafeResumeFileDiagnostics(logger, 'extraction_decision', wrappedError.diagnostics, 'warn')
      throw wrappedError
    }

    return {
      ...buildBase(),
      fileBufferBase64: Buffer.from(extractedText, 'utf8').toString('base64'),
      mimeType: 'text/plain',
      preparedMimeType: 'text/plain',
      sourceFormat: 'doc',
      inputKind: 'extracted_text',
      inputMode: 'extracted_text',
      extractionMethod: 'legacy_doc_text_extraction',
      extractedText,
      base64File: null,
      diagnostics: mergeSafeDiagnostics(buildPreparedPayloadDiagnostics({
        sourceFormat: 'doc',
        inputKind: 'extracted_text',
        inputMode: 'extracted_text',
        preparedMimeType: 'text/plain',
        originalMimeType: normalizedOriginalMimeType || normalizedMimeType || mimeType || null,
        extractedText,
        extractionMethod: 'legacy_doc_text_extraction',
      }), {
        extractionMethod: 'legacy_doc_text_extraction',
        extractedTextCharCount: extractedText.length,
        preparedMimeType: 'text/plain',
        inputKind: 'extracted_text',
      }),
    }
  }

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
      diagnostics: mergeSafeDiagnostics(buildPreparedPayloadDiagnostics({
        sourceFormat,
        inputKind: 'extracted_text',
        inputMode: 'extracted_text',
        preparedMimeType: 'text/plain',
        originalMimeType: normalizedOriginalMimeType || normalizedMimeType || null,
        extractedText,
        extractionMethod: 'text_plain_extraction',
      }), {
        extractionMethod: 'text_plain_extraction',
        extractedTextCharCount: extractedText.length,
        preparedMimeType: 'text/plain',
        inputKind: 'extracted_text',
      }),
    }
  }

  if (normalizedMimeType === 'application/pdf') {
    const pdfObserveOnlyEnabled = isPdfCanonicalExtractionObserveOnlyEnabled()
    let pdfCanonicalExtractionObserveOnly = { enabled: false }

    if (pdfObserveOnlyEnabled) {
      pdfCanonicalExtractionObserveOnly = await observePdfCanonicalTextExtraction(fileBuffer)
      logSafePdfCanonicalExtractionDiagnostics(logger, pdfCanonicalExtractionObserveOnly)
    }

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
      diagnostics: mergeSafeDiagnostics({
        ...buildPreparedPayloadDiagnostics({
          sourceFormat: 'pdf',
          inputKind: 'pdf_binary',
          inputMode: 'binary',
          preparedMimeType: normalizedMimeType,
          originalMimeType: normalizedOriginalMimeType || normalizedMimeType || null,
          extractionMethod: 'pdf_binary_provider_input',
          fallbackUsed: false,
        }),
        pdfCanonicalExtractionObserveOnlyEnabled: pdfObserveOnlyEnabled,
        pdfCanonicalExtractionObserveOnly,
      }, {
        extractionMethod: 'pdf_binary_provider_input',
        extractedTextCharCount: 0,
        preparedMimeType: normalizedMimeType,
        inputKind: 'pdf_binary',
      }),
    }
  }

  if (normalizedMimeType === DOCX_MIME_TYPE || lowerFilename.endsWith('.docx')) {
    let extractedText
    try {
      extractedText = await extractTextFromDocxBuffer(fileBuffer, normalizedFilename || 'resume.docx', {
        mimeType: normalizedMimeType || mimeType || DOCX_MIME_TYPE,
        originalMimeType: normalizedOriginalMimeType || normalizedMimeType || mimeType || null,
        fileSize,
        logger,
      })
    } catch (error) {
      error.diagnostics = mergeSafeDiagnostics(error.diagnostics || {}, {
        extractionMethod: 'docx_mammoth_text_extraction',
        extractedTextCharCount: error?.diagnostics?.mammothTextLength ?? 0,
        preparedMimeType: null,
        inputKind: 'extracted_text',
      })
      logSafeResumeFileDiagnostics(logger, 'extraction_decision', error.diagnostics, 'warn')
      throw error
    }
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
      diagnostics: mergeSafeDiagnostics(buildPreparedPayloadDiagnostics({
        sourceFormat: lowerFilename.endsWith('.docx') ? 'docx' : 'unknown',
        inputKind: 'extracted_text',
        inputMode: 'extracted_text',
        preparedMimeType: 'text/plain',
        originalMimeType: normalizedOriginalMimeType || normalizedMimeType || mimeType || null,
        extractedText,
        extractionMethod: 'docx_mammoth_text_extraction',
      }), {
        extractionMethod: 'docx_mammoth_text_extraction',
        extractedTextCharCount: extractedText.length,
        preparedMimeType: 'text/plain',
        inputKind: 'extracted_text',
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
    diagnostics: mergeSafeDiagnostics(buildPreparedPayloadDiagnostics({
      sourceFormat: 'unknown',
      inputKind: 'binary_unknown',
      inputMode: 'binary',
      preparedMimeType: normalizedMimeType || mimeType,
      originalMimeType: normalizedOriginalMimeType || normalizedMimeType || null,
      extractionMethod: 'unsupported_or_unknown',
    }), {
      extractionMethod: 'unsupported_or_unknown',
      extractedTextCharCount: 0,
      preparedMimeType: normalizedMimeType || mimeType,
      inputKind: 'binary_unknown',
    }),
  }
}
