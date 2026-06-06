#!/usr/bin/env node
import process from 'node:process'

import { extractTextFromLegacyDocBuffer } from '../src/services/legacyDocExtractionService.js'
import { measureExtractionQuality } from '../src/services/legacyDocExtractionQuality.js'
import {
  invalidLegacyDocFixtures,
  validLegacyDocFixtures,
} from '../src/services/__fixtures__/legacyDocQualityFixtures.js'

const quietLogger = { debug() {}, info() {}, warn() {} }

async function main() {
  const previousFlag = process.env.ENABLE_LEGACY_DOC_EXTRACTION
  process.env.ENABLE_LEGACY_DOC_EXTRACTION = 'true'

  try {
    const validResults = []
    for (const fixture of validLegacyDocFixtures) {
      validResults.push(await measureExtractionQuality(fixture, ({ buffer, filename, mimeType }) => extractTextFromLegacyDocBuffer(buffer, {
        filename,
        mimeType,
        logger: quietLogger,
      })))
    }

    const invalidResults = []
    for (const fixture of invalidLegacyDocFixtures) {
      invalidResults.push(await measureExtractionQuality(fixture, ({ buffer, filename, mimeType }) => extractTextFromLegacyDocBuffer(buffer, {
        filename,
        mimeType,
        logger: quietLogger,
      })))
    }

    const report = {
      generatedAt: new Date().toISOString(),
      note: 'Safe metrics only; raw extracted resume text, emails, phones, filenames, and binary content are intentionally omitted.',
      recommendationThresholds: {
        expectedMarkerCoveragePercent: '100 required for this synthetic validation; staging should not proceed below 95 on a larger corpus.',
        printableCharacterRatio: '>= 0.95',
        duplicateLineRatio: '<= 0.20',
        suspiciousBinaryNoiseRatio: '<= 0.02',
        extractionDurationMs: '<= 1000',
      },
      validDocFixtures: validResults.map(({ fixtureName, metrics, evaluation }) => ({ fixtureName, metrics, passed: evaluation.passed, checks: evaluation.checks })),
      invalidDocFixtures: invalidResults.map(({ fixtureName, metrics }) => ({ fixtureName, metrics, passed: metrics.success === false && metrics.errorCategory === 'legacy_doc_extraction_failed' })),
    }

    const validPass = report.validDocFixtures.every((entry) => entry.passed)
    const invalidPass = report.invalidDocFixtures.every((entry) => entry.passed)
    report.overallPass = validPass && invalidPass
    report.recommendation = report.overallPass
      ? 'B: Improve/validate the lightweight extractor against real staging-representative legacy DOCs before rollout; synthetic fixtures pass, but best-effort text-run extraction still cannot guarantee full Word structure, tables, or encrypted/corrupt-document detection.'
      : 'C: Stop and add a stronger controlled extractor/runtime dependency before rollout.'

    console.log(JSON.stringify(report, null, 2))
    if (!report.overallPass) process.exitCode = 1
  } finally {
    if (typeof previousFlag === 'undefined') delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
    else process.env.ENABLE_LEGACY_DOC_EXTRACTION = previousFlag
  }
}

await main()
