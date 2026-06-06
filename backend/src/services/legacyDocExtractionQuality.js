import { performance } from 'node:perf_hooks'

const DEFAULT_THRESHOLDS = Object.freeze({
  minimumMarkerCoveragePercent: 100,
  minimumPrintableCharacterRatio: 0.95,
  maximumDuplicateLineRatio: 0.2,
  maximumSuspiciousBinaryNoiseRatio: 0.02,
  maximumExtractionDurationMs: 1000,
})

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return 0
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

function getLines(text) {
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

function isSuspiciousBinaryNoise(char) {
  if (!char) return false
  const codePoint = char.codePointAt(0)
  if (codePoint === 0xfffd) return true
  if (codePoint === 0x00 || codePoint === 0x7f) return true
  if (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)) return true
  return false
}

export function calculateLegacyDocExtractionQualityMetrics({
  fixtureName,
  extractedText = '',
  expectedMarkers = [],
  error = null,
  durationMs = 0,
} = {}) {
  const text = String(extractedText || '')
  const chars = [...text]
  const lines = getLines(text)
  const normalizedText = text.toLowerCase()
  const normalizedMarkers = expectedMarkers.map((marker) => String(marker || '').trim()).filter(Boolean)
  const foundMarkers = normalizedMarkers.filter((marker) => normalizedText.includes(marker.toLowerCase()))
  const uniqueLineCount = new Set(lines.map((line) => line.toLowerCase())).size
  const duplicateLineCount = Math.max(0, lines.length - uniqueLineCount)
  const printableCount = chars.filter(isPrintableOrWhitespace).length
  const suspiciousCount = chars.filter(isSuspiciousBinaryNoise).length
  const errorCategory = error?.category || error?.extractionCategory || String(error?.message || '').match(/^([a-z0-9_]+)::/i)?.[1] || null

  return {
    fixtureName: String(fixtureName || 'unknown'),
    success: !error && text.length > 0,
    extractedTextLength: text.length,
    lineCount: lines.length,
    printableCharacterRatio: chars.length > 0 ? round(printableCount / chars.length) : 0,
    duplicateLineRatio: lines.length > 0 ? round(duplicateLineCount / lines.length) : 0,
    suspiciousBinaryNoiseRatio: chars.length > 0 ? round(suspiciousCount / chars.length) : 0,
    expectedMarkerCoveragePercent: normalizedMarkers.length > 0 ? round((foundMarkers.length / normalizedMarkers.length) * 100, 2) : 100,
    expectedMarkerCount: normalizedMarkers.length,
    expectedMarkersFound: foundMarkers.length,
    errorCategory,
    extractionDurationMs: round(durationMs, 2),
  }
}

export function evaluateLegacyDocExtractionQuality(metrics, thresholds = DEFAULT_THRESHOLDS) {
  const checks = {
    markerCoverage: metrics.expectedMarkerCoveragePercent >= thresholds.minimumMarkerCoveragePercent,
    printableCharacterRatio: metrics.printableCharacterRatio >= thresholds.minimumPrintableCharacterRatio,
    duplicateLineRatio: metrics.duplicateLineRatio <= thresholds.maximumDuplicateLineRatio,
    suspiciousBinaryNoiseRatio: metrics.suspiciousBinaryNoiseRatio <= thresholds.maximumSuspiciousBinaryNoiseRatio,
    extractionDuration: metrics.extractionDurationMs <= thresholds.maximumExtractionDurationMs,
  }

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    thresholds: { ...thresholds },
  }
}

export async function measureExtractionQuality(fixture, extract) {
  const start = performance.now()
  try {
    const extractedText = await extract(fixture)
    const durationMs = performance.now() - start
    const metrics = calculateLegacyDocExtractionQualityMetrics({
      fixtureName: fixture.name,
      extractedText,
      expectedMarkers: fixture.expectedMarkers,
      durationMs,
    })
    return {
      fixtureName: fixture.name,
      metrics,
      evaluation: evaluateLegacyDocExtractionQuality(metrics, fixture.thresholds),
    }
  } catch (error) {
    const durationMs = performance.now() - start
    const metrics = calculateLegacyDocExtractionQualityMetrics({
      fixtureName: fixture.name,
      expectedMarkers: fixture.expectedMarkers,
      error,
      durationMs,
    })
    return {
      fixtureName: fixture.name,
      metrics,
      evaluation: evaluateLegacyDocExtractionQuality(metrics, fixture.thresholds),
    }
  }
}

export { DEFAULT_THRESHOLDS }
