import { estimateExtractableText } from '../services/ocrService.js'

const IMAGE_ONLY_RATIO_THRESHOLD = 0.01
const LOW_QUALITY_RATIO_THRESHOLD = 0.18
const OCR_MIN_CONFIDENCE = 65
const RESUME_SECTION_SIGNAL_PATTERN = /\b(experience|education|skills?|projects?|summary|employment|certifications?)\b/i
const BINARY_ARTIFACT_PATTERN = /\b(?:obj|endobj|stream|endstream|xref|flatedecode|\/filter|\/length)\b/gi
const TOKEN_PATTERN = /[A-Za-z]{2,}/g

function hasPdfHeader(fileBuffer) {
  return String(fileBuffer.subarray(0, 8).toString('latin1')).includes('%PDF-')
}

function detectPdfEncryption(raw = '') {
  return /\/Encrypt\b/i.test(raw)
}

function looksLikeLikelyNonPdfPayload(raw = '') {
  const head = String(raw || '').slice(0, 4096).toLowerCase()
  return head.includes('<html')
    || head.includes('<!doctype html')
    || head.includes('{"error"')
    || head.includes('{"message"')
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
  const extractedText = String(extraction?.text || '')
  const alphaTokens = extractedText.match(TOKEN_PATTERN) || []
  const readableTokenCount = alphaTokens.filter((token) => token.length >= 3).length
  const readableTokenRatio = alphaTokens.length > 0 ? readableTokenCount / alphaTokens.length : 0
  const hasResumeSectionSignals = RESUME_SECTION_SIGNAL_PATTERN.test(extractedText)
  const artifactMatches = extractedText.match(BINARY_ARTIFACT_PATTERN) || []
  const binaryArtifactRatio = extractedText.length > 0
    ? artifactMatches.join('').length / extractedText.length
    : 1
  const lowExtractableTextLikely = normalizedMime === 'application/pdf' && extractableTextRatio < LOW_QUALITY_RATIO_THRESHOLD
  const lowReadableQualityLikely = normalizedMime === 'application/pdf'
    && !hasResumeSectionSignals
    && (readableTokenRatio < 0.62 || binaryArtifactRatio > 0.08)
  const routeToOcr = imageOnlyLikely || lowExtractableTextLikely || lowReadableQualityLikely

  return {
    ok: true,
    unrecoverable: false,
    extractableTextRatio,
    imageOnlyLikely,
    routeToOcr,
    textQuality: {
      lowExtractableTextLikely,
      lowReadableQualityLikely,
      readableTokenRatio,
      binaryArtifactRatio,
      hasResumeSectionSignals,
    },
    thresholds: {
      imageOnlyRatio: IMAGE_ONLY_RATIO_THRESHOLD,
      lowQualityRatio: LOW_QUALITY_RATIO_THRESHOLD,
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
