import { performance } from 'node:perf_hooks'
import {
  buildResumeTextFingerprint,
  compareResumeTextFingerprints,
  normalizeResumeTextForFingerprint,
  prepareResumePayloadForAnalysis,
} from './resumeDocumentExtractionService.js'
import { analyzeResumeWithConfiguredFallback } from './aiResumeAnalysisService.js'

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_PATTERN = /(?:\+?\d[\d().\-\s]{7,}\d)/g
const DEFAULT_SYNTHETIC_FILENAME_PATTERN = /^synthetic[-_a-z0-9.]+$/i

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return 0
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

function redactUnsafeText(value = '') {
  return String(value || '')
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(PHONE_PATTERN, (match) => {
      const digitCount = String(match || '').replace(/\D/g, '').length
      return digitCount >= 10 ? '[redacted-phone]' : match
    })
}

function hasUnsafeFilename(filename = '') {
  const normalized = String(filename || '').trim()
  if (!normalized) return false
  const hasEmail = EMAIL_PATTERN.test(normalized)
  EMAIL_PATTERN.lastIndex = 0
  const hasPhone = Array.from(normalized.matchAll(PHONE_PATTERN)).some((match) => String(match[0] || '').replace(/\D/g, '').length >= 10)
  PHONE_PATTERN.lastIndex = 0
  if (hasEmail || hasPhone) return true
  return !DEFAULT_SYNTHETIC_FILENAME_PATTERN.test(normalized)
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

export function calculateSafeTextQualityMetrics(text = '', expectedMarkers = []) {
  const safeText = redactUnsafeText(text)
  const chars = [...safeText]
  const lines = getLines(safeText)
  const normalizedText = safeText.toLowerCase()
  const normalizedMarkers = expectedMarkers.map((marker) => String(marker || '').trim()).filter(Boolean)
  const markersFound = normalizedMarkers.filter((marker) => normalizedText.includes(marker.toLowerCase()))
  const duplicateLineCount = Math.max(0, lines.length - new Set(lines.map((line) => line.toLowerCase())).size)
  const printableCount = chars.filter(isPrintableOrWhitespace).length
  const suspiciousCount = chars.filter(isSuspiciousNoise).length

  return {
    extractedTextLength: safeText.length,
    lineCount: lines.length,
    printableRatio: chars.length > 0 ? round(printableCount / chars.length) : 0,
    duplicateLineRatio: lines.length > 0 ? round(duplicateLineCount / lines.length) : 0,
    suspiciousNoiseRatio: chars.length > 0 ? round(suspiciousCount / chars.length) : 0,
    safeMarkerCoverage: {
      expected: normalizedMarkers.length,
      found: markersFound.length,
      ratio: normalizedMarkers.length > 0 ? round(markersFound.length / normalizedMarkers.length) : 1,
    },
  }
}

function buildFixtureResult({ fixture, preparedPayload, durationMs, expectedMarkers, profileExtractor }) {
  const extractedText = String(preparedPayload?.extractedText || '')
  const diagnostics = preparedPayload?.diagnostics || {}
  const pdfObserveOnly = diagnostics.pdfCanonicalExtractionObserveOnly && typeof diagnostics.pdfCanonicalExtractionObserveOnly === 'object'
    ? diagnostics.pdfCanonicalExtractionObserveOnly
    : null
  const observedFingerprint = pdfObserveOnly?.normalizedFingerprint || null
  const fingerprint = extractedText ? buildResumeTextFingerprint(extractedText) : null
  const profileFields = extractedText && typeof profileExtractor === 'function'
    ? profileExtractor(extractedText)
    : null

  return {
    fixtureId: fixture.id || fixture.name || 'unknown',
    sourceFormat: preparedPayload?.sourceFormat || diagnostics.sourceFormat || 'unknown',
    extractionMethod: diagnostics.extractionMethod || null,
    inputMode: preparedPayload?.resumeInputMode || diagnostics.inputMode || null,
    inputKind: diagnostics.inputKind || preparedPayload?.inputKind || null,
    mimeType: fixture.mimeType || null,
    preparedMimeType: preparedPayload?.mimeType || diagnostics.preparedMimeType || null,
    extractedTextLength: extractedText.length,
    normalizedFingerprint: fingerprint?.sha256 || null,
    normalizedFingerprintComparable: Boolean(fingerprint?.comparable),
    normalizedLineCount: fingerprint?.normalizedLineCount || 0,
    extractionDurationMs: round(durationMs, 2),
    ocrUsed: Boolean(diagnostics.ocrUsed),
    quality: calculateSafeTextQualityMetrics(extractedText, expectedMarkers),
    pdfCanonicalExtractionObserveOnly: pdfObserveOnly ? {
      enabled: Boolean(pdfObserveOnly.enabled),
      success: Boolean(pdfObserveOnly.success),
      extractionMethod: pdfObserveOnly.extractionMethod || null,
      parserVersion: pdfObserveOnly.parserVersion || null,
      durationMs: pdfObserveOnly.durationMs ?? null,
      inputByteSize: pdfObserveOnly.inputByteSize ?? null,
      pageCount: pdfObserveOnly.pageCount ?? null,
      pagesRead: pdfObserveOnly.pagesRead ?? null,
      observationTruncated: Boolean(pdfObserveOnly.observationTruncated),
      pageLimitReached: Boolean(pdfObserveOnly.pageLimitReached),
      lineCount: pdfObserveOnly.lineCount ?? null,
      extractedTextLength: pdfObserveOnly.extractedTextLength ?? 0,
      normalizedFingerprint: observedFingerprint,
      normalizedFingerprintComparable: Boolean(observedFingerprint),
      printableRatio: pdfObserveOnly.printableRatio ?? 0,
      suspiciousNoiseRatio: pdfObserveOnly.suspiciousNoiseRatio ?? 0,
      duplicateLineRatio: pdfObserveOnly.duplicateLineRatio ?? 0,
      safeSectionMarkerCoverage: pdfObserveOnly.safeSectionMarkerCoverage || null,
      qualityClassification: pdfObserveOnly.qualityClassification || null,
      ocrRequired: Boolean(pdfObserveOnly.ocrRequired),
      failureCategory: pdfObserveOnly.failureCategory || null,
    } : null,
    profileFields,
  }
}

export async function runResumeFormatExtractionDiagnostics(fixtures, options = {}) {
  const expectedMarkers = Array.isArray(options.expectedMarkers) ? options.expectedMarkers : []
  const results = []

  for (const fixture of fixtures) {
    if (hasUnsafeFilename(fixture.filename)) {
      throw new Error('diagnostic_fixture_filename_must_be_synthetic')
    }
    const startedAt = performance.now()
    const preparedPayload = await prepareResumePayloadForAnalysis({
      fileBufferBase64: Buffer.from(fixture.buffer).toString('base64'),
      mimeType: fixture.mimeType,
      originalMimeType: fixture.originalMimeType || fixture.mimeType,
      filename: fixture.filename,
      fileSize: fixture.buffer?.length || null,
      logger: options.logger || { debug() {}, info() {}, warn() {} },
      diagnosticsContext: {
        resumeId: fixture.resumeId || null,
        analysisId: fixture.analysisId || null,
        parseJobId: fixture.parseJobId || null,
        fileExtension: fixture.fileExtension || null,
      },
    })
    results.push(buildFixtureResult({
      fixture,
      preparedPayload,
      durationMs: performance.now() - startedAt,
      expectedMarkers,
      profileExtractor: options.profileExtractor,
    }))
  }

  const fingerprintComparisons = []
  for (let leftIndex = 0; leftIndex < results.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < results.length; rightIndex += 1) {
      const left = results[leftIndex]
      const right = results[rightIndex]
      const leftFingerprint = left.normalizedFingerprint || left.pdfCanonicalExtractionObserveOnly?.normalizedFingerprint || null
      const rightFingerprint = right.normalizedFingerprint || right.pdfCanonicalExtractionObserveOnly?.normalizedFingerprint || null
      const leftComparable = Boolean(left.normalizedFingerprintComparable || (left.pdfCanonicalExtractionObserveOnly?.normalizedFingerprintComparable && !left.pdfCanonicalExtractionObserveOnly?.observationTruncated))
      const rightComparable = Boolean(right.normalizedFingerprintComparable || (right.pdfCanonicalExtractionObserveOnly?.normalizedFingerprintComparable && !right.pdfCanonicalExtractionObserveOnly?.observationTruncated))
      const leftLineCount = left.normalizedLineCount || left.pdfCanonicalExtractionObserveOnly?.lineCount || 0
      const rightLineCount = right.normalizedLineCount || right.pdfCanonicalExtractionObserveOnly?.lineCount || 0
      const leftTextLength = left.extractedTextLength || left.pdfCanonicalExtractionObserveOnly?.extractedTextLength || 0
      const rightTextLength = right.extractedTextLength || right.pdfCanonicalExtractionObserveOnly?.extractedTextLength || 0
      fingerprintComparisons.push({
        leftFixtureId: left.fixtureId,
        rightFixtureId: right.fixtureId,
        comparable: Boolean(leftComparable && rightComparable),
        equivalent: Boolean(leftComparable && rightComparable && leftFingerprint === rightFingerprint),
        leftFingerprint,
        rightFingerprint,
        lineCountDelta: Math.abs(leftLineCount - rightLineCount),
        textLengthDelta: Math.abs(leftTextLength - rightTextLength),
      })
    }
  }

  return {
    fixtures: results,
    fingerprintComparisons,
    dominantSource: detectDominantVarianceSource({ extractionResults: results, scoringRuns: [] }),
  }
}

function normalizeLabel(candidate = {}) {
  return String(candidate?.matchScore?.fit || candidate?.verdict || candidate?.fit || '').trim().toLowerCase() || null
}

function normalizeScore(candidate = {}) {
  const raw = candidate?.matchScore?.score_out_of_ten ?? candidate?.matchScore?.score ?? candidate?.score ?? candidate?.profile_score
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return null
  return numeric > 10 ? round(numeric / 10, 2) : round(numeric, 2)
}

function summarizeAttempts(attempts = []) {
  return attempts.map((attempt) => ({
    success: Boolean(attempt?.success),
    provider: attempt?.provider || null,
    model: attempt?.model || null,
    role: attempt?.role || null,
    retryPolicy: attempt?.retryPolicy || null,
    retryReason: attempt?.retryReason || null,
    failureCategory: attempt?.failureCategory || null,
  }))
}

export async function runCanonicalScoringDiagnostics({
  canonicalText,
  iterations = 3,
  filename = 'synthetic-canonical-resume.txt',
  credentials,
  systemPromptConfig = { promptVersion: 1, isDefaultFallback: false },
  jobDescriptionContext = null,
  analyzeWithAnthropic,
  analyzeWithOpenAI,
} = {}) {
  if (hasUnsafeFilename(filename)) {
    throw new Error('diagnostic_fixture_filename_must_be_synthetic')
  }
  const normalizedCanonicalText = normalizeResumeTextForFingerprint(canonicalText)
  const canonicalFingerprint = buildResumeTextFingerprint(canonicalText)
  const runs = []

  for (let index = 0; index < iterations; index += 1) {
    const response = await analyzeResumeWithConfiguredFallback(
      Buffer.from(normalizedCanonicalText, 'utf8').toString('base64'),
      'text/plain',
      filename,
      {
        credentials,
        systemPromptConfig,
        jobDescriptionContext,
        analyzeWithAnthropic,
        analyzeWithOpenAI,
      },
    )
    const candidates = Array.isArray(response?.result?.candidates) ? response.result.candidates : []
    const primaryCandidate = candidates[0] || {}
    runs.push({
      iteration: index + 1,
      scoreOutOfTen: normalizeScore(primaryCandidate),
      matchLabel: normalizeLabel(primaryCandidate),
      provider: response?.provider || null,
      model: response?.model || null,
      promptVersion: response?.promptVersion || systemPromptConfig?.promptVersion || null,
      promptIsDefaultFallback: Boolean(response?.promptIsDefaultFallback),
      retryPath: summarizeAttempts(response?.attempts || []).filter((attempt) => attempt.retryPolicy || attempt.role === 'primary'),
      fallbackPath: summarizeAttempts(response?.attempts || []).filter((attempt) => attempt.role === 'fallback'),
      rankSignature: candidates.map((candidate) => ({
        id: candidate?.id || candidate?.name || null,
        scoreOutOfTen: normalizeScore(candidate),
        matchLabel: normalizeLabel(candidate),
      })),
    })
  }

  const scores = runs.map((run) => run.scoreOutOfTen).filter((score) => score !== null)
  const labels = runs.map((run) => run.matchLabel).filter(Boolean)
  const rankSignatures = runs.map((run) => JSON.stringify(run.rankSignature))

  return {
    canonicalFingerprint: canonicalFingerprint.sha256,
    canonicalLineCount: canonicalFingerprint.normalizedLineCount,
    runs,
    variance: {
      scoreMin: scores.length > 0 ? Math.min(...scores) : null,
      scoreMax: scores.length > 0 ? Math.max(...scores) : null,
      scoreDelta: scores.length > 0 ? round(Math.max(...scores) - Math.min(...scores), 2) : null,
      labelCount: new Set(labels).size,
      rankingCount: new Set(rankSignatures).size,
      providerCount: new Set(runs.map((run) => run.provider).filter(Boolean)).size,
      modelCount: new Set(runs.map((run) => run.model).filter(Boolean)).size,
    },
  }
}

export function detectDominantVarianceSource({ extractionResults = [], scoringRuns = [], persistenceEvents = [] } = {}) {
  const comparableExtractionPairs = []
  for (let leftIndex = 0; leftIndex < extractionResults.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < extractionResults.length; rightIndex += 1) {
      const left = extractionResults[leftIndex]
      const right = extractionResults[rightIndex]
      comparableExtractionPairs.push({
        comparable: Boolean(left.normalizedFingerprintComparable && right.normalizedFingerprintComparable),
        equivalent: Boolean(left.normalizedFingerprintComparable && right.normalizedFingerprintComparable && left.normalizedFingerprint === right.normalizedFingerprint),
      })
    }
  }

  const extractionVariance = comparableExtractionPairs.some((pair) => pair.comparable && !pair.equivalent)
    || extractionResults.some((result) => result.inputKind === 'pdf_binary' || result.quality?.safeMarkerCoverage?.ratio < 1)
  const scoreValues = scoringRuns.map((run) => run.scoreOutOfTen).filter((score) => score !== null && score !== undefined)
  const scoringVariance = scoreValues.length > 1 && (Math.max(...scoreValues) !== Math.min(...scoreValues)
    || new Set(scoringRuns.map((run) => run.matchLabel).filter(Boolean)).size > 1
    || new Set(scoringRuns.map((run) => JSON.stringify(run.rankSignature || []))).size > 1)
  const fallbackVariance = scoringRuns.some((run) => Array.isArray(run.fallbackPath) && run.fallbackPath.length > 0)
  const persistenceVariance = persistenceEvents.some((event) => event?.winnerChanged || event?.duplicateCompletion)

  if (extractionVariance && scoringVariance) return 'combined_extraction_and_scoring_variance'
  if (extractionVariance) return 'extraction_variance'
  if (scoringVariance) return 'scoring_nondeterminism'
  if (fallbackVariance) return 'retry_or_fallback_behavior'
  if (persistenceVariance) return 'async_persistence_behavior'
  return 'no_variance_detected'
}


export function buildPdfObserveOnlyStagingValidationSummary(report = {}) {
  const fixtures = Array.isArray(report?.fixtures) ? report.fixtures : []
  const pdfDiagnostics = fixtures
    .map((fixture) => fixture?.pdfCanonicalExtractionObserveOnly)
    .filter((diagnostic) => diagnostic && diagnostic.enabled)
  const classificationCounts = {}
  for (const diagnostic of pdfDiagnostics) {
    const key = diagnostic.qualityClassification || diagnostic.failureCategory || 'unknown'
    classificationCounts[key] = (classificationCounts[key] || 0) + 1
  }
  const comparablePairs = Array.isArray(report?.fingerprintComparisons)
    ? report.fingerprintComparisons.filter((comparison) => comparison.comparable)
    : []
  const equivalentPairs = comparablePairs.filter((comparison) => comparison.equivalent)
  const durations = pdfDiagnostics.map((diagnostic) => Number(diagnostic.durationMs)).filter(Number.isFinite)
  const textLengths = pdfDiagnostics.map((diagnostic) => Number(diagnostic.extractedTextLength)).filter(Number.isFinite)
  const markerRatios = pdfDiagnostics.map((diagnostic) => Number(diagnostic.safeSectionMarkerCoverage?.ratio)).filter(Number.isFinite)

  return {
    totalPdfFixtures: pdfDiagnostics.length,
    parserSuccessCount: pdfDiagnostics.filter((diagnostic) => diagnostic.success).length,
    parserFailureCount: pdfDiagnostics.filter((diagnostic) => !diagnostic.success).length,
    parserSuccessRate: pdfDiagnostics.length > 0 ? round(pdfDiagnostics.filter((diagnostic) => diagnostic.success).length / pdfDiagnostics.length) : 0,
    classificationCounts,
    averageDurationMs: durations.length > 0 ? round(durations.reduce((sum, value) => sum + value, 0) / durations.length, 2) : 0,
    maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
    averageExtractedTextLength: textLengths.length > 0 ? round(textLengths.reduce((sum, value) => sum + value, 0) / textLengths.length, 2) : 0,
    averageSectionMarkerCoverage: markerRatios.length > 0 ? round(markerRatios.reduce((sum, value) => sum + value, 0) / markerRatios.length) : 0,
    comparablePairCount: comparablePairs.length,
    equivalentPairCount: equivalentPairs.length,
    equivalentPairRate: comparablePairs.length > 0 ? round(equivalentPairs.length / comparablePairs.length) : 0,
    ocrRequiredCount: pdfDiagnostics.filter((diagnostic) => diagnostic.ocrRequired).length,
    observationTruncatedCount: pdfDiagnostics.filter((diagnostic) => diagnostic.observationTruncated).length,
  }
}

export function compareCanonicalTexts(leftText = '', rightText = '') {
  return compareResumeTextFingerprints(leftText, rightText)
}

export function evaluateAsyncPersistenceIdempotency(events = []) {
  const completionsByResume = new Map()
  const findings = []
  for (const event of events) {
    const resumeId = String(event?.resumeId || '').trim()
    if (!resumeId || event?.status !== 'complete') continue
    const existing = completionsByResume.get(resumeId)
    if (existing) {
      findings.push({
        resumeId,
        duplicateCompletion: true,
        winnerChanged: JSON.stringify(existing.persistedResult || null) !== JSON.stringify(event.persistedResult || null),
        firstParseJobId: existing.parseJobId || null,
        laterParseJobId: event.parseJobId || null,
      })
    }
    completionsByResume.set(resumeId, event)
  }
  return {
    idempotent: findings.length === 0,
    findings,
  }
}
