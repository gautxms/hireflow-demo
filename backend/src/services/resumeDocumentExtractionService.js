import mammoth from 'mammoth'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOC_MIME = 'application/msword'

function hasDocxExtension(filename = '') {
  return String(filename || '').trim().toLowerCase().endsWith('.docx')
}

function hasDocExtension(filename = '') {
  return String(filename || '').trim().toLowerCase().endsWith('.doc')
}

function createExtractionError(category, details) {
  return new Error(`${category}::${JSON.stringify(details)}`)
}

export async function extractTextFromDocxBuffer(fileBuffer, filename = '') {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw createExtractionError('docx_empty_extraction', {
      reason: 'input_buffer_empty',
      filename: String(filename || ''),
    })
  }

  try {
    const result = await mammoth.extractRawText({ buffer: fileBuffer })
    const extractedText = String(result?.value || '').replace(/\r\n/g, '\n').trim()

    if (!extractedText) {
      throw createExtractionError('docx_empty_extraction', {
        reason: 'extracted_text_empty',
        filename: String(filename || ''),
      })
    }

    return extractedText
  } catch (error) {
    if (String(error?.message || '').startsWith('docx_empty_extraction::')) {
      throw error
    }
    throw createExtractionError('docx_empty_extraction', {
      reason: 'docx_parse_failed',
      filename: String(filename || ''),
      message: String(error?.message || 'unknown_docx_parse_error').slice(0, 300),
    })
  }
}

export async function prepareResumePayloadForAnalysis({ fileBufferBase64, mimeType, filename }) {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase()
  const normalizedFilename = String(filename || '').trim()

  const isLegacyDoc = normalizedMimeType === DOC_MIME || hasDocExtension(normalizedFilename)
  if (isLegacyDoc) {
    throw createExtractionError('legacy_word_format', {
      reason: 'doc_legacy_not_supported',
      filename: normalizedFilename,
      mimeType: normalizedMimeType || null,
    })
  }

  const isDocx = normalizedMimeType === DOCX_MIME || hasDocxExtension(normalizedFilename)
  if (!isDocx) {
    return {
      fileBufferBase64,
      mimeType,
      filename,
      inputMode: 'document_file',
    }
  }

  const fileBuffer = Buffer.from(String(fileBufferBase64 || ''), 'base64')
  const extractedText = await extractTextFromDocxBuffer(fileBuffer, normalizedFilename)

  return {
    fileBufferBase64: Buffer.from(extractedText, 'utf8').toString('base64'),
    mimeType: 'text/plain',
    filename: normalizedFilename,
    inputMode: 'extracted_text',
  }
}
