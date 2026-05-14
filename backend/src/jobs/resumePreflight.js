import { estimateExtractableText } from '../services/ocrService.js'

const IMAGE_ONLY_RATIO_THRESHOLD = 0.01
const OCR_MIN_CONFIDENCE = 65

function hasPdfHeader(fileBuffer) {
  return String(fileBuffer.subarray(0, 8).toString('latin1')).includes('%PDF-')
}

function detectPdfEncryption(raw = '') {
  return /\/Encrypt\b/i.test(raw)
}

function looksLikeLikelyNonPdfPayload(raw = '') {
  const head = String(raw || '').slice(0, 4096).toLowerCase()
  const headWithoutHeader = head.replace(/^%pdf-[^\n\r]*[\r\n]*/, '')
  const hasPdfObjectMarker = /\b\d+\s+\d+\s+obj\b/.test(headWithoutHeader)
  const hasXrefMarker = /\bxref\b/.test(headWithoutHeader)
  const hasTypeDictionaryMarker = /\/type\s*\//.test(headWithoutHeader)
  const hasStreamBlockMarker = /\bstream\b[\s\S]{0,512}\bendstream\b/.test(headWithoutHeader)
  const likelyPdfStructure = hasPdfObjectMarker || hasXrefMarker || hasTypeDictionaryMarker || hasStreamBlockMarker
  const htmlPayloadEarly = /^\s*(<!doctype\s+html|<html)\b/.test(headWithoutHeader)
  const jsonErrorPayloadEarly = /^\s*\{\s*"(?:error|message)"\s*:/.test(headWithoutHeader)
  return !likelyPdfStructure && (htmlPayloadEarly || jsonErrorPayloadEarly)
}

function mapHardFailure(failureCategory, message) {
  return {
    ok: false,
    unrecoverable: true,
    parseOutcome: 'failed',
    failureCategory,
    failureMessageUserSafe: message,
  }
}

export function runResumePreflight({ mimeType, fileBuffer }) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    return mapHardFailure('corrupt_or_unreadable', 'This file is empty or unreadable. Please upload a different copy.')
  }

  const normalizedMime = String(mimeType || '').toLowerCase()
  const extraction = estimateExtractableText(fileBuffer)

  if (normalizedMime === 'application/pdf') {
    if (!hasPdfHeader(fileBuffer)) {
      return mapHardFailure('unsupported_encoding_or_format', 'This PDF appears to be malformed or uses an unsupported encoding.')
    }

    const raw = fileBuffer.toString('latin1')
    if (detectPdfEncryption(raw)) {
      return mapHardFailure('encrypted_or_password_protected_pdf', 'This PDF is password protected. Please upload an unlocked copy.')
    }

    if (looksLikeLikelyNonPdfPayload(raw)) {
      return mapHardFailure('unsupported_encoding_or_format', 'This file appears to be a non-PDF payload. Please upload a valid PDF file.')
    }
  }

  const extractableTextRatio = extraction.ratio
  const imageOnlyLikely = normalizedMime === 'application/pdf' && extractableTextRatio <= IMAGE_ONLY_RATIO_THRESHOLD

  return {
    ok: true,
    unrecoverable: false,
    extractableTextRatio,
    imageOnlyLikely,
    routeToOcr: imageOnlyLikely,
    thresholds: {
      imageOnlyRatio: IMAGE_ONLY_RATIO_THRESHOLD,
      ocrMinConfidence: OCR_MIN_CONFIDENCE,
    },
  }
}

export function evaluateOcrOutcome({ ocrConfidence }) {
  const confidence = Number(ocrConfidence || 0)
  if (!Number.isFinite(confidence) || confidence < OCR_MIN_CONFIDENCE) {
    return {
      parseOutcome: confidence > 0 ? 'partial' : 'failed',
      failureCategory: 'image_only_low_ocr',
      failureMessageUserSafe: 'We could only read limited text from this image-based resume. Please upload a clearer file.',
      ocrConfidence: confidence,
      ocrMinConfidence: OCR_MIN_CONFIDENCE,
    }
  }

  return null
}
