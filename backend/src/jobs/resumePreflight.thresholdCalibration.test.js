import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_THRESHOLDS } from './resumePreflight.js'

const FAILED_CASES = Array.from({ length: 40 }, (_, idx) => ({
  id: `failed_${idx + 1}`,
  isCorrupt: false,
  extractableTextRatio: 0.09 + ((idx % 5) * 0.008),
  readableTokenRatio: 0.55 + ((idx % 4) * 0.015),
  binaryArtifactRatio: 0.06 + ((idx % 3) * 0.01),
  hasResumeSectionSignals: idx % 3 !== 0,
  extractedTextLength: 760 + ((idx % 6) * 70),
  ocrConfidence: 54 + (idx % 6),
}))

const CONTROL_CASES = Array.from({ length: 30 }, (_, idx) => ({
  id: `control_${idx + 1}`,
  isCorrupt: idx < 6,
  extractableTextRatio: idx < 6 ? 0.005 + (idx * 0.0005) : 0.18 + ((idx % 4) * 0.02),
  readableTokenRatio: idx < 6 ? 0.21 + (idx * 0.03) : 0.63 + ((idx % 3) * 0.05),
  binaryArtifactRatio: idx < 6 ? 0.16 + ((idx % 3) * 0.04) : 0.03 + ((idx % 2) * 0.02),
  hasResumeSectionSignals: idx >= 6,
  extractedTextLength: idx < 6 ? 140 + (idx * 40) : 1050 + ((idx % 5) * 120),
  ocrConfidence: idx < 6 ? 25 + (idx * 3) : 74 + (idx % 5),
}))

const SAMPLE_SET = [...FAILED_CASES, ...CONTROL_CASES]

function evaluateCase(sample, thresholds) {
  const imageOnlyLikely = sample.extractableTextRatio <= thresholds.imageOnlyRatio
  const lowExtractableTextLikely = sample.extractableTextRatio < thresholds.lowQualityRatio
  const hasStrongTextLength = sample.extractedTextLength >= thresholds.strongTextLength
  const lowReadableQualityLikely = !sample.hasResumeSectionSignals
    && ((sample.readableTokenRatio < thresholds.lowReadableTokenRatio
      || sample.binaryArtifactRatio > thresholds.lowReadableBinaryArtifactRatio)
      && (!hasStrongTextLength || sample.binaryArtifactRatio > thresholds.strongTextBinaryArtifactRatio))

  const routeToOcr = imageOnlyLikely || lowExtractableTextLikely || lowReadableQualityLikely
  const guardrailBypass = sample.extractedTextLength >= thresholds.strongTextLength
    && sample.readableTokenRatio >= thresholds.moderateReadableTokenRatio
  const lowOcrFailure = routeToOcr && sample.ocrConfidence < thresholds.ocrMinConfidence && !guardrailBypass
  return {
    falseFail: !sample.isCorrupt && lowOcrFailure,
    corruptAccepted: sample.isCorrupt && !lowOcrFailure,
  }
}

function score(thresholds) {
  return SAMPLE_SET.reduce((acc, sample) => {
    const result = evaluateCase(sample, thresholds)
    if (result.falseFail) acc.falseFails += 1
    if (result.corruptAccepted) acc.corruptAccepted += 1
    return acc
  }, { falseFails: 0, corruptAccepted: 0 })
}

test('offline threshold sweep reduces false failures without increasing corrupt acceptance', () => {
  const baselineThresholds = { ...DEFAULT_THRESHOLDS, lowQualityRatio: 0.14, ocrMinConfidence: 60 }
  const baseline = score(baselineThresholds)
  const calibrated = score(DEFAULT_THRESHOLDS)

  const sweepLowQuality = [0.1, 0.11, 0.12, 0.13, 0.14]
  const sweepOcrConfidence = [54, 56, 58, 60]
  const evaluatedCombinations = []
  for (const lowQualityRatio of sweepLowQuality) {
    for (const ocrMinConfidence of sweepOcrConfidence) {
      const thresholds = { ...DEFAULT_THRESHOLDS, lowQualityRatio, ocrMinConfidence }
      evaluatedCombinations.push({ thresholds, metrics: score(thresholds) })
    }
  }

  const calibratedInSweep = evaluatedCombinations.find(
    ({ thresholds }) => thresholds.lowQualityRatio === DEFAULT_THRESHOLDS.lowQualityRatio
      && thresholds.ocrMinConfidence === DEFAULT_THRESHOLDS.ocrMinConfidence,
  )

  assert.ok(calibratedInSweep, 'expected calibrated thresholds to be present in sweep')
  assert.ok(calibrated.falseFails < baseline.falseFails)
  assert.equal(calibrated.corruptAccepted, baseline.corruptAccepted)
})
