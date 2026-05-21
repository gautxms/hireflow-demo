import mammoth from 'mammoth'

function decodeBase64ToBuffer(fileBufferBase64) {
  return Buffer.from(String(fileBufferBase64 || ''), 'base64')
}

export async function extractTextFromDocxBuffer(fileBuffer, filename = 'resume.docx') {
  try {
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

  if (normalizedMimeType === 'text/plain') {
    return {
      fileBufferBase64,
      mimeType: 'text/plain',
      inputMode: 'text/plain',
    }
  }

  if (normalizedMimeType === 'application/pdf') {
    return {
      fileBufferBase64,
      mimeType,
      inputMode: 'binary',
    }
  }

  if (normalizedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerFilename.endsWith('.docx')) {
    const fileBuffer = decodeBase64ToBuffer(fileBufferBase64)
    const extractedText = await extractTextFromDocxBuffer(fileBuffer, normalizedFilename || 'resume.docx')
    return {
      fileBufferBase64: Buffer.from(extractedText, 'utf8').toString('base64'),
      mimeType: 'text/plain',
      inputMode: 'extracted_text',
    }
  }

  return {
    fileBufferBase64,
    mimeType,
    inputMode: 'binary',
  }
}
