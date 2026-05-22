let mammothClient = null

async function getMammothClient() {
  if (mammothClient) {
    return mammothClient
  }

  try {
    const mammothModule = await import('mammoth')
    mammothClient = mammothModule?.default || mammothModule
    return mammothClient
  } catch (error) {
    throw new Error('docx_dependency_missing::DOCX parsing dependency is unavailable. Please reinstall dependencies.')
  }
}

function decodeBase64ToBuffer(fileBufferBase64) {
  return Buffer.from(String(fileBufferBase64 || ''), 'base64')
}

export async function extractTextFromDocxBuffer(fileBuffer, filename = 'resume.docx') {
  try {
    const mammoth = await getMammothClient()
    const { value } = await mammoth.extractRawText({ buffer: fileBuffer })
    const extractedText = String(value || '').trim()
    if (!extractedText) {
      throw new Error(`docx_empty_extraction::Unable to extract text content from DOCX file ${filename}.`)
    }
    return extractedText
  } catch (error) {
    if (String(error?.message || '').startsWith('docx_empty_extraction::')) {
      throw error
    }
    if (String(error?.message || '').startsWith('docx_dependency_missing::')) {
      throw error
    }
    throw new Error(`docx_empty_extraction::Unable to extract text content from DOCX file ${filename}.`)
  }
}

export async function prepareResumePayloadForAnalysis({ fileBufferBase64, mimeType, filename }) {
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

  if (normalizedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerFilename.endsWith('.docx')) {
    const fileBuffer = decodeBase64ToBuffer(fileBufferBase64)
    const extractedText = await extractTextFromDocxBuffer(fileBuffer, normalizedFilename || 'resume.docx')
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
