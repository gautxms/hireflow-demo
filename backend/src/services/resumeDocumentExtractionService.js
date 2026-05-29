let mammothClient = null

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOCX_DOCUMENT_XML_PATH = 'word/document.xml'

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
    return {
      ...buildBase(),
      fileBufferBase64,
      mimeType: 'text/plain',
      preparedMimeType: 'text/plain',
      sourceFormat: lowerFilename.endsWith('.txt') ? 'txt' : 'unknown',
      inputKind: 'extracted_text',
      inputMode: 'extracted_text',
      extractedText: Buffer.from(String(fileBufferBase64 || ''), 'base64').toString('utf8').trim(),
      base64File: null,
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
  }
}
