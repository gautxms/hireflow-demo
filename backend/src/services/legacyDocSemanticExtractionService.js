import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import {
  buildResumeTextFingerprint,
  normalizeResumeTextForFingerprint,
} from './resumeTextFingerprint.js'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_MAX_OUTPUT_CHARS = 20000
const PACKAGE_NAME = 'word-extractor'
const PACKAGE_VERSION = '1.0.4'
const EXTRACTION_METHOD = 'legacy_doc_word_extractor_observe_only'
const SCORING_EXPERIMENT_EXTRACTION_METHOD = 'legacy_doc_word_extractor_semantic_text_scoring_experiment'

const ELIGIBILITY_REASON = {
  masterDisabled: 'master_disabled',
  unsupportedFormat: 'unsupported_format',
  userAllowlist: 'user_allowlist',
  analysisAllowlist: 'analysis_allowlist',
  deterministicSample: 'deterministic_sample',
  notAllowlisted: 'not_allowlisted',
  sampleNotSelected: 'sample_not_selected',
}
const MATCHED_ALLOWLIST_TYPE = {
  userId: 'user_id',
  analysisId: 'analysis_id',
}
const CATEGORY = {
  usable: 'usable_text_extraction',
  empty: 'empty_extraction',
  textTooShort: 'text_too_short',
  duplicateLines: 'suspicious_duplicate_lines',
  lowPrintable: 'suspicious_low_printable_ratio',
  binaryNoise: 'suspicious_binary_noise',
  outputTruncated: 'output_truncated',
  timeout: 'parser_timeout',
  fileTooLarge: 'file_too_large',
  dependencyImportFailed: 'dependency_import_failed',
  parserError: 'parser_error',
}

let wordExtractorClient = null
let wordExtractorClientOverrideForTests = undefined

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return 0
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
}

function normalizeFeatureFlag(value) {
  return String(value || '').trim().toLowerCase()
}

function parseCommaSeparatedAllowlist(value) {
  return new Set(String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean))
}

function normalizeObserveOnlySampleRate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return 0
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return 0
  if (!Number.isInteger(numeric)) return 0
  return numeric
}

function buildDeterministicSamplingBucket(stableIdentifier) {
  const normalized = String(stableIdentifier || '').trim()
  if (!normalized) return null
  const hashPrefix = createHash('sha256')
    .update('legacy-doc-semantic-observe-only-sampling-v1:')
    .update(normalized)
    .digest('hex')
    .slice(0, 12)
  return Number.parseInt(hashPrefix, 16) % 10000
}

function buildErrorFingerprint(error) {
  const message = String(error?.message || error || '').trim()
  if (!message) return null
  return createHash('sha256')
    .update('legacy-doc-semantic-extraction-error-v1:')
    .update(message)
    .digest('hex')
    .slice(0, 16)
}

function getLines(text = '') {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function isPrintableOrWhitespace(char) {
  if (!char) return false
  if (/\s/u.test(char)) return true
  const codePoint = char.codePointAt(0)
  return codePoint >= 0x20 && codePoint !== 0x7f && codePoint !== 0xfffd
}

function isSuspiciousNoise(char) {
  if (!char) return false
  const codePoint = char.codePointAt(0)
  if (codePoint === 0xfffd || codePoint === 0x00 || codePoint === 0x7f) return true
  return codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)
}

function calculateSafeTextQualityMetrics(text = '') {
  const safeText = String(text || '')
  const chars = [...safeText]
  const lines = getLines(safeText)
  const duplicateLineCount = Math.max(0, lines.length - new Set(lines.map((line) => line.toLowerCase())).size)
  const printableCount = chars.filter(isPrintableOrWhitespace).length
  const suspiciousCount = chars.filter(isSuspiciousNoise).length

  return {
    duplicateLineRatio: lines.length > 0 ? round(duplicateLineCount / lines.length) : 0,
    printableRatio: chars.length > 0 ? round(printableCount / chars.length) : 0,
    suspiciousNoiseRatio: chars.length > 0 ? round(suspiciousCount / chars.length) : 0,
  }
}

function classifySemanticExtraction({ text, metrics, outputTruncated, failureCategory = null } = {}) {
  if (failureCategory) return failureCategory
  const textLength = String(text || '').trim().length
  if (outputTruncated) return CATEGORY.outputTruncated
  if (textLength === 0) return CATEGORY.empty
  if (textLength < 80) return CATEGORY.textTooShort
  if (metrics.duplicateLineRatio > 0.35) return CATEGORY.duplicateLines
  if (metrics.printableRatio > 0 && metrics.printableRatio < 0.92) return CATEGORY.lowPrintable
  if (metrics.suspiciousNoiseRatio > 0.03) return CATEGORY.binaryNoise
  return CATEGORY.usable
}

function buildDefaultDiagnostics({ eligibility = {}, fileBuffer = null, currentLegacyText = '', failureCategory = null, error = null, durationMs = 0 } = {}) {
  const currentFingerprint = buildResumeTextFingerprint(currentLegacyText || '')
  return {
    enabled: Boolean(eligibility.masterEnabled),
    masterEnabled: Boolean(eligibility.masterEnabled),
    eligible: Boolean(eligibility.eligible),
    eligibilityReason: eligibility.eligibilityReason || ELIGIBILITY_REASON.masterDisabled,
    allowlistMatched: Boolean(eligibility.allowlistMatched),
    matchedAllowlistType: eligibility.matchedAllowlistType || null,
    sampled: Boolean(eligibility.sampled),
    sampleRate: Number.isFinite(Number(eligibility.sampleRate)) ? Number(eligibility.sampleRate) : 0,
    samplingBucket: Number.isInteger(eligibility.samplingBucket) ? eligibility.samplingBucket : null,
    success: false,
    extractionMethod: EXTRACTION_METHOD,
    parserPackageName: PACKAGE_NAME,
    parserPackageVersion: PACKAGE_VERSION,
    durationMs: round(durationMs, 2),
    inputByteSize: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0,
    outputTruncated: false,
    semanticTextLength: 0,
    semanticNormalizedCharCount: 0,
    semanticNormalizedLineCount: 0,
    semanticNormalizedFingerprint: null,
    currentLegacyNormalizedCharCount: currentFingerprint?.normalizedCharCount || 0,
    currentLegacyNormalizedLineCount: currentFingerprint?.normalizedLineCount || 0,
    currentLegacyNormalizedFingerprint: currentFingerprint?.sha256 || null,
    normalizedCharCountDelta: currentFingerprint?.normalizedCharCount || 0,
    normalizedLineCountDelta: currentFingerprint?.normalizedLineCount || 0,
    duplicateLineRatio: 0,
    printableRatio: 0,
    suspiciousNoiseRatio: 0,
    qualityClassification: failureCategory || null,
    failureCategory: failureCategory || null,
    errorFingerprint: error ? buildErrorFingerprint(error) : null,
    scoringFallbackReason: 'observe_only',
  }
}

function compactEligibility(eligibility = {}) {
  return {
    masterEnabled: Boolean(eligibility.masterEnabled),
    eligible: Boolean(eligibility.eligible),
    eligibilityReason: eligibility.eligibilityReason || ELIGIBILITY_REASON.masterDisabled,
    allowlistMatched: Boolean(eligibility.allowlistMatched),
    matchedAllowlistType: eligibility.matchedAllowlistType || null,
    sampled: Boolean(eligibility.sampled),
    sampleRate: Number.isFinite(Number(eligibility.sampleRate)) ? Number(eligibility.sampleRate) : 0,
    samplingBucket: Number.isInteger(eligibility.samplingBucket) ? eligibility.samplingBucket : null,
  }
}

function omitSemanticText(result = null) {
  if (!result || typeof result !== 'object') return result
  const safeResult = { ...result }
  delete safeResult.semanticText
  delete safeResult.semanticTextForScoring
  delete safeResult.semanticTextForFingerprint
  delete safeResult.extractedText
  delete safeResult.rawText
  delete safeResult.text
  delete safeResult.body
  delete safeResult.binaryContent
  delete safeResult.base64File
  delete safeResult.fileBufferBase64
  return safeResult
}

function normalizeSemanticTextForScoring(text = '') {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeWordExtractorText(document) {
  if (!document) return ''
  const candidates = []
  for (const getter of ['getBody', 'getTextboxes', 'getHeaders', 'getFooters', 'getFootnotes', 'getEndnotes']) {
    if (typeof document[getter] === 'function') {
      candidates.push(document[getter]())
    }
  }
  if (candidates.length === 0 && typeof document === 'string') candidates.push(document)
  if (candidates.length === 0 && typeof document?.body === 'string') candidates.push(document.body)
  if (candidates.length === 0 && typeof document?.text === 'string') candidates.push(document.text)
  return candidates.map((value) => String(value || '').trim()).filter(Boolean).join('\n').trim()
}

function withTimeout(promise, timeoutMs) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('legacy_doc_semantic_extraction_timeout')
      error.category = CATEGORY.timeout
      reject(error)
    }, timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

async function getWordExtractorClient() {
  if (wordExtractorClientOverrideForTests !== undefined) {
    if (!wordExtractorClientOverrideForTests) {
      const error = new Error('word_extractor_import_failed')
      error.category = CATEGORY.dependencyImportFailed
      throw error
    }
    return wordExtractorClientOverrideForTests
  }

  if (wordExtractorClient) return wordExtractorClient

  try {
    const module = await import(PACKAGE_NAME)
    const WordExtractor = module?.default || module?.WordExtractor || module
    if (typeof WordExtractor === 'function') {
      wordExtractorClient = new WordExtractor()
    } else {
      wordExtractorClient = WordExtractor
    }
    if (!wordExtractorClient || typeof wordExtractorClient.extract !== 'function') {
      throw new Error('word_extractor_extract_unavailable')
    }
    return wordExtractorClient
  } catch (error) {
    const wrapped = new Error('word_extractor_import_failed', { cause: error })
    wrapped.category = CATEGORY.dependencyImportFailed
    throw wrapped
  }
}

export function __setLegacyDocSemanticExtractorForTests(client) {
  wordExtractorClientOverrideForTests = client
}

export function __resetLegacyDocSemanticExtractorForTests() {
  wordExtractorClientOverrideForTests = undefined
  wordExtractorClient = null
}

export function isLegacyDocSemanticExtractionObserveOnlyEnabled(env = process.env) {
  return TRUE_VALUES.has(normalizeFeatureFlag(env?.LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED))
}

export function isLegacyDocSemanticTextScoringExperimentEnabled(env = process.env) {
  return TRUE_VALUES.has(normalizeFeatureFlag(env?.LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED))
}

export function getLegacyDocSemanticExtractionLimits(env = process.env) {
  return {
    maxBytes: normalizePositiveInteger(env?.LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_BYTES, DEFAULT_MAX_BYTES),
    timeoutMs: normalizePositiveInteger(env?.LEGACY_DOC_SEMANTIC_EXTRACTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxOutputChars: normalizePositiveInteger(env?.LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_OUTPUT_CHARS, DEFAULT_MAX_OUTPUT_CHARS),
  }
}

export function evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({
  env = process.env,
  userId = null,
  analysisId = null,
  resumeId = null,
  fileContentFingerprint = null,
  isLegacyBinaryDoc = false,
} = {}) {
  const masterEnabled = isLegacyDocSemanticExtractionObserveOnlyEnabled(env)
  const sampleRate = normalizeObserveOnlySampleRate(env?.LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE)
  const base = {
    masterEnabled,
    eligible: false,
    eligibilityReason: ELIGIBILITY_REASON.masterDisabled,
    allowlistMatched: false,
    matchedAllowlistType: null,
    sampled: false,
    sampleRate,
    samplingBucket: null,
  }

  if (!masterEnabled) return base
  if (!isLegacyBinaryDoc) return { ...base, eligibilityReason: ELIGIBILITY_REASON.unsupportedFormat }

  const normalizedUserId = userId === null || userId === undefined ? '' : String(userId).trim()
  const normalizedAnalysisId = analysisId === null || analysisId === undefined ? '' : String(analysisId).trim()
  const allowedUserIds = parseCommaSeparatedAllowlist(env?.LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS)
  const allowedAnalysisIds = parseCommaSeparatedAllowlist(env?.LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS)

  if (normalizedUserId && allowedUserIds.has(normalizedUserId)) {
    return {
      ...base,
      eligible: true,
      eligibilityReason: ELIGIBILITY_REASON.userAllowlist,
      allowlistMatched: true,
      matchedAllowlistType: MATCHED_ALLOWLIST_TYPE.userId,
    }
  }

  if (normalizedAnalysisId && allowedAnalysisIds.has(normalizedAnalysisId)) {
    return {
      ...base,
      eligible: true,
      eligibilityReason: ELIGIBILITY_REASON.analysisAllowlist,
      allowlistMatched: true,
      matchedAllowlistType: MATCHED_ALLOWLIST_TYPE.analysisId,
    }
  }

  if (sampleRate <= 0) return { ...base, eligibilityReason: ELIGIBILITY_REASON.notAllowlisted }

  const stableSamplingIdentifier = fileContentFingerprint || resumeId || normalizedAnalysisId || null
  const samplingBucket = buildDeterministicSamplingBucket(stableSamplingIdentifier)
  const threshold = Math.floor(sampleRate * 100)
  const sampled = samplingBucket !== null && threshold > 0 && samplingBucket < threshold

  return {
    ...base,
    eligibilityReason: sampled ? ELIGIBILITY_REASON.deterministicSample : ELIGIBILITY_REASON.sampleNotSelected,
    eligible: sampled,
    sampled,
    samplingBucket,
  }
}


export function evaluateLegacyDocSemanticTextScoringExperimentEligibility({
  env = process.env,
  userId = null,
  analysisId = null,
  isLegacyBinaryDoc = false,
} = {}) {
  const masterEnabled = isLegacyDocSemanticTextScoringExperimentEnabled(env)
  const base = {
    masterEnabled,
    eligible: false,
    eligibilityReason: ELIGIBILITY_REASON.masterDisabled,
    allowlistMatched: false,
    matchedAllowlistType: null,
    sampled: false,
    sampleRate: 0,
    samplingBucket: null,
  }

  if (!masterEnabled) return base
  if (!isLegacyBinaryDoc) return { ...base, eligibilityReason: ELIGIBILITY_REASON.unsupportedFormat }

  const normalizedUserId = userId === null || userId === undefined ? '' : String(userId).trim()
  const normalizedAnalysisId = analysisId === null || analysisId === undefined ? '' : String(analysisId).trim()
  const allowedUserIds = parseCommaSeparatedAllowlist(env?.LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS)
  const allowedAnalysisIds = parseCommaSeparatedAllowlist(env?.LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_ANALYSIS_IDS)

  if (normalizedUserId && allowedUserIds.has(normalizedUserId)) {
    return {
      ...base,
      eligible: true,
      eligibilityReason: ELIGIBILITY_REASON.userAllowlist,
      allowlistMatched: true,
      matchedAllowlistType: MATCHED_ALLOWLIST_TYPE.userId,
    }
  }

  if (normalizedAnalysisId && allowedAnalysisIds.has(normalizedAnalysisId)) {
    return {
      ...base,
      eligible: true,
      eligibilityReason: ELIGIBILITY_REASON.analysisAllowlist,
      allowlistMatched: true,
      matchedAllowlistType: MATCHED_ALLOWLIST_TYPE.analysisId,
    }
  }

  return { ...base, eligibilityReason: ELIGIBILITY_REASON.notAllowlisted }
}

export async function observeLegacyDocSemanticExtraction(fileBuffer, options = {}) {
  const {
    env = process.env,
    eligibility = null,
    currentLegacyText = '',
    includeSemanticText = false,
  } = options || {}
  const startedAt = performance.now()
  const limits = getLegacyDocSemanticExtractionLimits(env)
  const resolvedEligibility = eligibility || evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env })

  if (!resolvedEligibility.eligible) {
    return buildDefaultDiagnostics({
      eligibility: resolvedEligibility,
      fileBuffer,
      currentLegacyText,
      failureCategory: null,
      durationMs: performance.now() - startedAt,
    })
  }

  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    return buildDefaultDiagnostics({ eligibility: resolvedEligibility, fileBuffer, currentLegacyText, failureCategory: CATEGORY.parserError, durationMs: performance.now() - startedAt })
  }

  if (fileBuffer.length > limits.maxBytes) {
    return buildDefaultDiagnostics({ eligibility: resolvedEligibility, fileBuffer, currentLegacyText, failureCategory: CATEGORY.fileTooLarge, error: new Error('file_too_large'), durationMs: performance.now() - startedAt })
  }

  try {
    const client = await getWordExtractorClient()
    const document = await withTimeout(Promise.resolve(client.extract(fileBuffer)), limits.timeoutMs)
    const rawSemanticText = normalizeWordExtractorText(document)
    const outputTruncated = rawSemanticText.length > limits.maxOutputChars
    const boundedSemanticText = outputTruncated ? rawSemanticText.slice(0, limits.maxOutputChars) : rawSemanticText
    const semanticTextForScoring = normalizeSemanticTextForScoring(boundedSemanticText)
    const semanticTextForFingerprint = normalizeResumeTextForFingerprint(semanticTextForScoring)
    const semanticFingerprint = buildResumeTextFingerprint(semanticTextForFingerprint)
    const currentFingerprint = buildResumeTextFingerprint(currentLegacyText || '')
    const normalizedMetrics = calculateSafeTextQualityMetrics(semanticTextForFingerprint)
    const scoringMetrics = calculateSafeTextQualityMetrics(semanticTextForScoring)
    const boundedRawMetrics = calculateSafeTextQualityMetrics(boundedSemanticText)
    const metrics = {
      duplicateLineRatio: normalizedMetrics.duplicateLineRatio,
      printableRatio: scoringMetrics.printableRatio > 0 ? Math.min(normalizedMetrics.printableRatio || scoringMetrics.printableRatio, scoringMetrics.printableRatio, boundedRawMetrics.printableRatio || scoringMetrics.printableRatio) : normalizedMetrics.printableRatio,
      suspiciousNoiseRatio: Math.max(normalizedMetrics.suspiciousNoiseRatio, scoringMetrics.suspiciousNoiseRatio, boundedRawMetrics.suspiciousNoiseRatio),
    }
    const qualityClassification = classifySemanticExtraction({ text: semanticTextForScoring, metrics, outputTruncated })
    const success = qualityClassification === CATEGORY.usable || qualityClassification === CATEGORY.outputTruncated

    const result = {
      ...buildDefaultDiagnostics({ eligibility: resolvedEligibility, fileBuffer, currentLegacyText }),
      success,
      durationMs: round(performance.now() - startedAt, 2),
      outputTruncated,
      semanticTextLength: semanticTextForScoring.length,
      semanticNormalizedCharCount: semanticFingerprint?.normalizedCharCount || 0,
      semanticNormalizedLineCount: semanticFingerprint?.normalizedLineCount || 0,
      semanticNormalizedFingerprint: semanticFingerprint?.sha256 || null,
      currentLegacyNormalizedCharCount: currentFingerprint?.normalizedCharCount || 0,
      currentLegacyNormalizedLineCount: currentFingerprint?.normalizedLineCount || 0,
      currentLegacyNormalizedFingerprint: currentFingerprint?.sha256 || null,
      normalizedCharCountDelta: Math.abs((semanticFingerprint?.normalizedCharCount || 0) - (currentFingerprint?.normalizedCharCount || 0)),
      normalizedLineCountDelta: Math.abs((semanticFingerprint?.normalizedLineCount || 0) - (currentFingerprint?.normalizedLineCount || 0)),
      duplicateLineRatio: metrics.duplicateLineRatio,
      printableRatio: metrics.printableRatio,
      suspiciousNoiseRatio: metrics.suspiciousNoiseRatio,
      qualityClassification,
      failureCategory: success ? null : qualityClassification,
      errorFingerprint: null,
      semanticTextForScoring,
      semanticTextForFingerprint,
    }
    return includeSemanticText ? result : omitSemanticText(result)
  } catch (error) {
    const category = Object.values(CATEGORY).includes(error?.category) ? error.category : CATEGORY.parserError
    return buildDefaultDiagnostics({
      eligibility: resolvedEligibility,
      fileBuffer,
      currentLegacyText,
      failureCategory: category,
      error,
      durationMs: performance.now() - startedAt,
    })
  }
}

export function toSafeLegacyDocSemanticExtractionDiagnostics(result = null) {
  return omitSemanticText(result)
}

export function logSafeLegacyDocSemanticExtractionEligibility(logger, eligibility) {
  const target = logger?.info || logger?.log
  if (typeof target === 'function') {
    target.call(logger, '[ResumeDiagnostics] legacy_doc_semantic_extraction_observe_only_eligibility', compactEligibility(eligibility))
  }
}

export function logSafeLegacyDocSemanticExtractionDiagnostics(logger, diagnostics) {
  const safeDiagnostics = toSafeLegacyDocSemanticExtractionDiagnostics(diagnostics)
  const target = safeDiagnostics?.success ? (logger?.info || logger?.log) : (logger?.warn || logger?.log)
  if (typeof target === 'function') {
    target.call(logger, '[ResumeDiagnostics] legacy_doc_semantic_extraction_observe_only', safeDiagnostics)
  }
}

export const LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ELIGIBILITY_REASONS = ELIGIBILITY_REASON
export const LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_CATEGORIES = CATEGORY
export const LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_EXTRACTION_METHOD = SCORING_EXPERIMENT_EXTRACTION_METHOD
export const LEGACY_DOC_SEMANTIC_EXTRACTION_PARSER_METADATA = {
  packageName: PACKAGE_NAME,
  packageVersion: PACKAGE_VERSION,
  extractionMethod: EXTRACTION_METHOD,
}
