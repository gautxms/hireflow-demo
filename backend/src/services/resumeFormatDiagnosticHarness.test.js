import test from 'node:test'
import assert from 'node:assert/strict'

import {
  __resetMammothClientForTests,
  __setMammothClientForTests,
} from './resumeDocumentExtractionService.js'
import {
  calculateSafeTextQualityMetrics,
  compareCanonicalTexts,
  detectDominantVarianceSource,
  evaluateAsyncPersistenceIdempotency,
  runCanonicalScoringDiagnostics,
  runResumeFormatExtractionDiagnostics,
} from './resumeFormatDiagnosticHarness.js'
import {
  SYNTHETIC_CANONICAL_RESUME_TEXT,
  SYNTHETIC_MARKERS,
  buildEquivalentFormatFixtures,
  buildLowQualityLegacyDocFixture,
  buildMissingTextPdfFixture,
  buildSyntheticDocxResumeFixture,
  buildSyntheticLegacyDocResumeFixture,
  buildSyntheticPdfResumeFixture,
} from './resumeFormatDiagnosticFixtures.js'

const quietLogger = { debug() {}, info() {}, warn() {}, log() {} }

function withLegacyDocExtractionEnabled(fn) {
  return async () => {
    const previous = process.env.ENABLE_LEGACY_DOC_EXTRACTION
    process.env.ENABLE_LEGACY_DOC_EXTRACTION = 'true'
    try {
      await fn()
    } finally {
      if (previous === undefined) delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
      else process.env.ENABLE_LEGACY_DOC_EXTRACTION = previous
      __resetMammothClientForTests()
    }
  }
}

function buildCredentials() {
  return {
    activeProvider: 'anthropic',
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
    providers: {
      anthropic: { primary: { apiKey: 'anthropic-key', model: 'claude-test', source: 'diagnostic-test' } },
      openai: { primary: { apiKey: 'openai-key', model: 'gpt-test', source: 'diagnostic-test' } },
    },
  }
}

function okResponse({ provider = 'anthropic', model = 'claude-test', score = 8.4, label = 'strong match', id = 'synthetic-alpha' } = {}) {
  return {
    provider,
    model,
    promptVersion: 7,
    promptIsDefaultFallback: false,
    tokenUsage: { usageAvailable: false, unavailableReason: 'diagnostic_test' },
    tokenBudgetAttempts: [],
    result: {
      candidates: [
        {
          id,
          name: 'Synthetic Candidate Alpha',
          score: score * 10,
          verdict: label,
          matchScore: { score_out_of_ten: score, fit: label },
        },
      ],
    },
  }
}

test('diagnostic harness records equivalent DOC, DOCX, and PDF fixture input modes without raw text', withLegacyDocExtractionEnabled(async () => {
  __setMammothClientForTests({
    extractRawText: async () => ({ value: SYNTHETIC_CANONICAL_RESUME_TEXT }),
  })

  const report = await runResumeFormatExtractionDiagnostics(await buildEquivalentFormatFixtures(), {
    expectedMarkers: SYNTHETIC_MARKERS,
    logger: quietLogger,
  })

  const byId = Object.fromEntries(report.fixtures.map((entry) => [entry.fixtureId, entry]))
  assert.equal(byId['synthetic-pdf'].inputKind, 'pdf_binary')
  assert.equal(byId['synthetic-pdf'].inputMode, 'binary')
  assert.equal(byId['synthetic-pdf'].extractionMethod, 'pdf_binary_provider_input')
  assert.equal(byId['synthetic-pdf'].normalizedFingerprint, null)
  assert.equal(byId['synthetic-docx'].inputKind, 'extracted_text')
  assert.equal(byId['synthetic-docx'].inputMode, 'extracted_text')
  assert.equal(byId['synthetic-docx'].extractionMethod, 'docx_mammoth_text_extraction')
  assert.equal(byId['synthetic-doc'].inputKind, 'extracted_text')
  assert.equal(byId['synthetic-doc'].extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(byId['synthetic-docx'].quality.safeMarkerCoverage.ratio, 1)
  assert.ok(byId['synthetic-doc'].quality.safeMarkerCoverage.ratio >= 0.8)
  assert.equal(report.dominantSource, 'extraction_variance')

  const serialized = JSON.stringify(report)
  assert.equal(serialized.includes('Synthetic Candidate Alpha'), false)
  assert.equal(serialized.includes('synthetic-equivalent-resume'), false)
}))

test('normalized fingerprints ignore whitespace-only and page header/footer differences', () => {
  const baseline = 'Resume\nSynthetic Candidate Alpha\nSkills: Node.js\nPage 1 of 2\nConfidential\n'
  const variant = '\n\nsynthetic candidate alpha\r\nSkills:   Node.js\r\nPage 2\nResume\n'
  const comparison = compareCanonicalTexts(baseline, variant)

  assert.equal(comparison.comparable, true)
  assert.equal(comparison.equivalent, true)
  assert.equal(comparison.lineCountDelta, 0)
})

test('missing-text PDF is diagnosed as provider binary input with no extracted fingerprint', withLegacyDocExtractionEnabled(async () => {
  const report = await runResumeFormatExtractionDiagnostics([buildMissingTextPdfFixture()], {
    expectedMarkers: SYNTHETIC_MARKERS,
    logger: quietLogger,
  })

  const [pdf] = report.fixtures
  assert.equal(pdf.inputKind, 'pdf_binary')
  assert.equal(pdf.inputMode, 'binary')
  assert.equal(pdf.extractedTextLength, 0)
  assert.equal(pdf.normalizedFingerprintComparable, false)
  assert.equal(pdf.quality.safeMarkerCoverage.ratio, 0)
}))

test('low-quality extraction metrics detect missing marker coverage and line duplication', withLegacyDocExtractionEnabled(async () => {
  const report = await runResumeFormatExtractionDiagnostics([buildLowQualityLegacyDocFixture()], {
    expectedMarkers: SYNTHETIC_MARKERS,
    logger: quietLogger,
  })
  const [doc] = report.fixtures

  assert.equal(doc.inputKind, 'extracted_text')
  assert.ok(doc.quality.safeMarkerCoverage.ratio < 1)
  assert.ok(doc.quality.duplicateLineRatio >= 0)
}))

test('safe text quality metrics redact emails and phone numbers from diagnostic calculations', () => {
  const metrics = calculateSafeTextQualityMetrics('Synthetic Candidate Alpha alpha@example.invalid 555-010-0000', ['Synthetic Candidate Alpha'])
  const serialized = JSON.stringify(metrics)

  assert.equal(metrics.safeMarkerCoverage.ratio, 1)
  assert.equal(serialized.includes('alpha@example.invalid'), false)
  assert.equal(serialized.includes('555-010-0000'), false)
})

test('repeated scoring of exact canonical input reports no variance when provider response is stable', async () => {
  const diagnostics = await runCanonicalScoringDiagnostics({
    canonicalText: SYNTHETIC_CANONICAL_RESUME_TEXT,
    iterations: 3,
    credentials: buildCredentials(),
    systemPromptConfig: { promptVersion: 7, isDefaultFallback: false },
    jobDescriptionContext: { hasContext: true, source: 'test', description: 'Node.js PostgreSQL', requirements: 'Node.js PostgreSQL' },
    analyzeWithAnthropic: async () => okResponse(),
    analyzeWithOpenAI: async () => okResponse({ provider: 'openai', model: 'gpt-test' }),
  })

  assert.equal(diagnostics.variance.scoreDelta, 0)
  assert.equal(diagnostics.variance.labelCount, 1)
  assert.equal(diagnostics.variance.rankingCount, 1)
  assert.equal(diagnostics.runs.every((run) => run.scoreOutOfTen === 8.4), true)
})

test('repeated scoring of exact canonical input reports score, label, and ranking variance', async () => {
  const scriptedScores = [8.4, 6.2, 8.4]
  const diagnostics = await runCanonicalScoringDiagnostics({
    canonicalText: SYNTHETIC_CANONICAL_RESUME_TEXT,
    iterations: 3,
    credentials: buildCredentials(),
    systemPromptConfig: { promptVersion: 7, isDefaultFallback: false },
    analyzeWithAnthropic: async () => {
      const score = scriptedScores.shift()
      return okResponse({ score, label: score < 7 ? 'possible match' : 'strong match' })
    },
  })

  assert.equal(diagnostics.variance.scoreDelta, 2.2)
  assert.equal(diagnostics.variance.labelCount, 2)
  assert.equal(detectDominantVarianceSource({ scoringRuns: diagnostics.runs }), 'scoring_nondeterminism')
})

test('retry and provider fallback path are captured without raw canonical text', async () => {
  let anthropicCalls = 0
  const diagnostics = await runCanonicalScoringDiagnostics({
    canonicalText: SYNTHETIC_CANONICAL_RESUME_TEXT,
    iterations: 1,
    credentials: buildCredentials(),
    systemPromptConfig: { promptVersion: 7, isDefaultFallback: false },
    analyzeWithAnthropic: async () => {
      anthropicCalls += 1
      throw new Error('response_truncated_error::synthetic primary failure')
    },
    analyzeWithOpenAI: async () => okResponse({ provider: 'openai', model: 'gpt-test', score: 7.1, label: 'good match' }),
  })

  assert.equal(anthropicCalls, 1)
  assert.equal(diagnostics.runs[0].provider, 'openai')
  assert.equal(diagnostics.runs[0].fallbackPath.length, 1)
  assert.ok(String(diagnostics.runs[0].fallbackPath[0].provider).includes('openai'))
  assert.equal(JSON.stringify(diagnostics).includes('Synthetic Candidate Alpha'), false)
})

test('async persistence diagnostic flags duplicate completions with changed winners', () => {
  const diagnostic = evaluateAsyncPersistenceIdempotency([
    { resumeId: 'resume-1', parseJobId: 'job-1', status: 'complete', persistedResult: { score: 8.4 } },
    { resumeId: 'resume-1', parseJobId: 'job-2', status: 'complete', persistedResult: { score: 6.2 } },
  ])

  assert.equal(diagnostic.idempotent, false)
  assert.equal(diagnostic.findings[0].duplicateCompletion, true)
  assert.equal(diagnostic.findings[0].winnerChanged, true)
})

test('equivalent DOC and DOCX extracted text fingerprints match when local extraction is canonical', withLegacyDocExtractionEnabled(async () => {
  __setMammothClientForTests({ extractRawText: async () => ({ value: SYNTHETIC_CANONICAL_RESUME_TEXT }) })
  const docx = await buildSyntheticDocxResumeFixture()
  const doc = buildSyntheticLegacyDocResumeFixture()
  const report = await runResumeFormatExtractionDiagnostics([docx, doc], {
    expectedMarkers: SYNTHETIC_MARKERS,
    logger: quietLogger,
  })

  assert.equal(report.fingerprintComparisons.length, 1)
  assert.equal(report.fingerprintComparisons[0].comparable, true)
  assert.equal(report.fingerprintComparisons[0].equivalent, true)
}))

test('PDF fixture remains non-comparable to extracted text formats until unified PDF extraction exists', withLegacyDocExtractionEnabled(async () => {
  __setMammothClientForTests({ extractRawText: async () => ({ value: SYNTHETIC_CANONICAL_RESUME_TEXT }) })
  const docx = await buildSyntheticDocxResumeFixture()
  const pdf = buildSyntheticPdfResumeFixture()
  const report = await runResumeFormatExtractionDiagnostics([pdf, docx], {
    expectedMarkers: SYNTHETIC_MARKERS,
    logger: quietLogger,
  })

  assert.equal(report.fingerprintComparisons[0].comparable, false)
  assert.equal(report.dominantSource, 'extraction_variance')
}))
