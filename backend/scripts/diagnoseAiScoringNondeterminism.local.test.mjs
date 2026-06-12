import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SYNTHETIC_AI_SCORING_RESUME_TEXT,
  assertAiScoringDiagnosticsOptIn,
  calculateAiScoringVariance,
  resolveRunCount,
  runAiScoringNondeterminismDiagnostics,
} from './diagnoseAiScoringNondeterminism.local.mjs'

function credentials() {
  return {
    activeProvider: 'anthropic',
    governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
    providers: {
      anthropic: { primary: { apiKey: 'synthetic-key', model: 'claude-diagnostic', source: 'test' } },
    },
  }
}

function okResponse({ score = 52, providerBodyMarker = 'PROVIDER_SECRET_BODY' } = {}) {
  return {
    provider: 'anthropic-primary',
    model: 'claude-diagnostic',
    promptVersion: 11,
    mode: 'compact',
    tokenUsage: { usageAvailable: true, inputTokens: 101, outputTokens: 42, totalTokens: 143 },
    result: {
      candidates: [{
        score,
        profile_score: score - 2,
        verdict: 'diagnostic verdict',
        fit_assessment: { overall_fit_score: score - 1 },
        matchScore: { score_out_of_ten: score / 10, fit: 'diagnostic fit' },
        providerResponseBody: providerBodyMarker,
      }],
    },
  }
}

test('AI nondeterminism harness rejects run counts above 10 and defaults to 5', () => {
  assert.equal(resolveRunCount(undefined), 5)
  assert.equal(resolveRunCount(''), 5)
  assert.equal(resolveRunCount('10'), 10)
  assert.throws(() => resolveRunCount('11'), /run_count_exceeds_maximum_10/)
})

test('AI nondeterminism harness requires explicit local staging opt-in flag', () => {
  assert.throws(() => assertAiScoringDiagnosticsOptIn({}), /local_ai_scoring_diagnostics_opt_in_required/)
  assert.doesNotThrow(() => assertAiScoringDiagnosticsOptIn({ ENABLE_LOCAL_AI_SCORING_DIAGNOSTICS: 'true' }))
})

test('AI nondeterminism harness reuses identical prepared input fingerprint and emits safe summaries', async () => {
  const report = await runAiScoringNondeterminismDiagnostics({
    runCount: 3,
    env: { ENABLE_LOCAL_AI_SCORING_DIAGNOSTICS: 'true' },
    credentials: credentials(),
    systemPromptConfig: { promptVersion: 11, isDefaultFallback: false, systemPrompt: 'Return safe JSON.' },
    analyzeWithAnthropic: async () => okResponse(),
  })
  const fingerprints = new Set(report.runs.map((run) => run.preparedInputFingerprint))
  const serialized = JSON.stringify(report)

  assert.equal(report.runs.length, 3)
  assert.equal(fingerprints.size, 1)
  assert.equal(report.variance.identicalPreparedInputFingerprintAcrossRuns, true)
  assert.equal(serialized.includes(SYNTHETIC_AI_SCORING_RESUME_TEXT), false)
  assert.equal(serialized.includes('PROVIDER_SECRET_BODY'), false)
})

test('AI nondeterminism harness safely emits null for unavailable telemetry fields', async () => {
  const report = await runAiScoringNondeterminismDiagnostics({
    runCount: 1,
    env: { ENABLE_LOCAL_AI_SCORING_DIAGNOSTICS: 'true' },
    credentials: credentials(),
    systemPromptConfig: { promptVersion: 11, isDefaultFallback: false, systemPrompt: 'Return safe JSON.' },
    analyzeWithAnthropic: async () => ({
      provider: 'anthropic-primary',
      model: 'claude-diagnostic',
      result: { candidates: [{ verdict: 'diagnostic verdict' }] },
    }),
  })
  const [run] = report.runs

  assert.equal(run.score, null)
  assert.equal(run.profileScore, null)
  assert.equal(run.fitAssessmentOverallScore, null)
  assert.equal(run.matchScore, null)
  assert.equal(run.inputTokens, null)
  assert.equal(run.outputTokens, null)
  assert.equal(run.totalTokens, null)
})

test('AI nondeterminism aggregate variance calculates min, max, average, range, and distinct count', () => {
  const variance = calculateAiScoringVariance([
    { score: 48, preparedInputFingerprint: 'same', selectedProvider: 'p', selectedModel: 'm', promptVersion: 1, compactMode: 'compact', retryAttemptCount: 0 },
    { score: 52, preparedInputFingerprint: 'same', selectedProvider: 'p', selectedModel: 'm', promptVersion: 1, compactMode: 'compact', retryAttemptCount: 0 },
    { score: 52, preparedInputFingerprint: 'same', selectedProvider: 'p', selectedModel: 'm', promptVersion: 1, compactMode: 'compact', retryAttemptCount: 0 },
  ])

  assert.equal(variance.minimumScore, 48)
  assert.equal(variance.maximumScore, 52)
  assert.equal(variance.scoreRange, 4)
  assert.equal(variance.averageScore, 50.6667)
  assert.equal(variance.distinctScoreCount, 2)
  assert.equal(variance.providerModelStableAcrossRuns, true)
})
