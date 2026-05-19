import { estimateExtractableText } from '../services/ocrService.js'

const IMAGE_ONLY_RATIO_THRESHOLD = 0.01
const LOW_QUALITY_RATIO_THRESHOLD = 0.14
const OCR_MIN_CONFIDENCE = 60
const STRONG_TEXT_LENGTH_THRESHOLD = 800
const MODERATE_READABLE_TOKEN_RATIO = 0.58
const RESUME_SECTION_SIGNAL_PATTERN = /\b(experience|education|skills?|projects?|summary|employment|certifications?)\b/i
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){1}\d{3}[-.\s]?\d{4}\b/
const PROFESSIONAL_PROFILE_PATTERN = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/|github\.com\/)[A-Za-z0-9-_/%.]+\b/i
const DATE_RANGE_PATTERN = /\b(?:19|20)\d{2}\s*[-–]\s*(?:(?:19|20)\d{2}|present|current)\b/i
const MONTH_DATE_PATTERN = /\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(?:19|20)\d{2}\b/i
const ROLE_PATTERN = /\b(?:software|senior|staff|lead|principal|frontend|backend|full[-\s]?stack|data|product|project|sales|marketing|operations|design|qa|devops|engineering)\s+(?:engineer|developer|manager|analyst|specialist|consultant|designer|architect|director)\b/i
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
  const hasEmailSignal = EMAIL_PATTERN.test(extractedText)
  const hasPhoneSignal = PHONE_PATTERN.test(extractedText)
  const hasProfessionalProfileSignal = PROFESSIONAL_PROFILE_PATTERN.test(extractedText)
  const hasDateRangeSignal = DATE_RANGE_PATTERN.test(extractedText) || MONTH_DATE_PATTERN.test(extractedText)
  const hasRolePatternSignal = ROLE_PATTERN.test(extractedText)
  const resumeSignalCount = [
    hasResumeSectionSignals,
    hasEmailSignal,
    hasPhoneSignal,
    hasProfessionalProfileSignal,
    hasDateRangeSignal,
    hasRolePatternSignal,
  ].filter(Boolean).length
  const artifactMatches = extractedText.match(BINARY_ARTIFACT_PATTERN) || []
  const binaryArtifactRatio = extractedText.length > 0
    ? artifactMatches.join('').length / extractedText.length
    : 1
  const lowExtractableTextLikely = normalizedMime === 'application/pdf' && extractableTextRatio < LOW_QUALITY_RATIO_THRESHOLD
  const hasStrongTextLength = extractedText.length >= STRONG_TEXT_LENGTH_THRESHOLD
  const hasModerateReadability = readableTokenRatio >= MODERATE_READABLE_TOKEN_RATIO && binaryArtifactRatio <= 0.12
  const strongNegativeSignals = [
    readableTokenRatio < 0.45,
    binaryArtifactRatio > 0.15,
    resumeSignalCount === 0,
  ].filter(Boolean).length
  const recruiterLikeStructureLikely = hasStrongTextLength && hasModerateReadability && resumeSignalCount >= 2
  const lowReadableQualityLikely = normalizedMime === 'application/pdf'
    && (
      !recruiterLikeStructureLikely
        ? ((readableTokenRatio < 0.58 || binaryArtifactRatio > 0.1) && (!hasStrongTextLength || binaryArtifactRatio > 0.2))
        : strongNegativeSignals >= 2
    )
  const routeToOcr = imageOnlyLikely || lowExtractableTextLikely || lowReadableQualityLikely
  const diagnostics = {
    extractableTextRatio,
    readableTokenRatio,
    binaryArtifactRatio,
    hasResumeSectionSignals,
    hasEmailSignal,
    hasPhoneSignal,
    hasProfessionalProfileSignal,
    hasDateRangeSignal,
    hasRolePatternSignal,
    resumeSignalCount,
    strongNegativeSignals,
    recruiterLikeStructureLikely,
    routeToOcr,
    hasStrongTextLength,
    hasModerateReadability,
    extractedTextLength: extractedText.length,
    readableQualityGatePassed: !lowReadableQualityLikely,
  }

  return {
    ok: true,
    unrecoverable: false,
    extractableTextRatio,
    imageOnlyLikely,
    routeToOcr,
    diagnostics,
    textQuality: {
      lowExtractableTextLikely,
      lowReadableQualityLikely,
      readableTokenRatio,
      binaryArtifactRatio,
      hasResumeSectionSignals,
      hasEmailSignal,
      hasPhoneSignal,
      hasProfessionalProfileSignal,
      hasDateRangeSignal,
      hasRolePatternSignal,
      resumeSignalCount,
    },
    thresholds: {
      imageOnlyRatio: IMAGE_ONLY_RATIO_THRESHOLD,
      lowQualityRatio: LOW_QUALITY_RATIO_THRESHOLD,
      ocrMinConfidence: OCR_MIN_CONFIDENCE,
    },
  }
}

export function evaluateOcrOutcome({ ocrConfidence, preflightDiagnostics = {}, extractedTextLength = 0 }) {
  const confidence = Number(ocrConfidence || 0)
  const guardrailBypass = Number(extractedTextLength || 0) >= STRONG_TEXT_LENGTH_THRESHOLD
    && Number(preflightDiagnostics?.readableTokenRatio || 0) >= MODERATE_READABLE_TOKEN_RATIO
  const confidenceValid = Number.isFinite(confidence)
  const confidenceBelowThreshold = !confidenceValid || confidence < OCR_MIN_CONFIDENCE
  const decisionDiagnostics = {
    ocrConfidence: confidence,
    ocrMinConfidence: OCR_MIN_CONFIDENCE,
    confidenceBelowThreshold,
    thresholdDecision: confidenceBelowThreshold ? 'below_threshold' : 'pass',
    guardrailBypass,
  }
  if (confidenceBelowThreshold && !guardrailBypass) {
    return {
      parseOutcome: confidence > 0 ? 'partial' : 'failed',
      failureCategory: 'image_only_low_ocr',
      failureMessageUserSafe: 'We could only read limited text from this image-based resume. Please upload a clearer file.',
      ocrConfidence: confidence,
      ocrMinConfidence: OCR_MIN_CONFIDENCE,
      diagnostics: decisionDiagnostics,
    }
  }

  return null
}
