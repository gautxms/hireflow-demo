import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import {
  SYNTHETIC_AI_SCORING_RESUME_TEXT,
  SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT,
  assertAiScoringDiagnosticsOptIn,
  assertSingleProviderAttemptForNondeterminismMode,
  calculateAiScoringVariance,
  isDirectExecution,
  resolveRunCount,
  runAiScoringNondeterminismDiagnostics,
} from './diagnoseAiScoringNondeterminism.local.mjs'

const ENABLED_ENV = {
  ENABLE_LOCAL_AI_SCORING_DIAGNOSTICS: 'true',
  AI_MAX_PROVIDER_ATTEMPTS_PER_FILE: '1',
}

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

test('AI nondeterminism harness requires one provider attempt for default mode', () => {
  assert.throws(() => assertSingleProviderAttemptForNondeterminismMode({}), /single_provider_attempt_required_for_nondeterminism_mode/)
  assert.throws(() => assertSingleProviderAttemptForNondeterminismMode({ AI_MAX_PROVIDER_ATTEMPTS_PER_FILE: '2' }), /single_provider_attempt_required_for_nondeterminism_mode/)
  assert.doesNotThrow(() => assertSingleProviderAttemptForNondeterminismMode({ AI_MAX_PROVIDER_ATTEMPTS_PER_FILE: '1' }))
})

test('AI nondeterminism harness succeeds with AI_MAX_PROVIDER_ATTEMPTS_PER_FILE=1 and reuses identical prepared input fingerprint', async () => {
  const report = await runAiScoringNondeterminismDiagnostics({
    runCount: 3,
    env: ENABLED_ENV,
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

test('AI nondeterminism harness uses the fixed synthetic JD context for every run and does not serialize JD content', async () => {
  const seenContexts = []
  const report = await runAiScoringNondeterminismDiagnostics({
    runCount: 2,
    env: ENABLED_ENV,
    credentials: credentials(),
    systemPromptConfig: { promptVersion: 11, isDefaultFallback: false, systemPrompt: 'Return safe JSON.' },
    analyzeWithAnthropic: async (_base64, _mime, _filename, options) => {
      seenContexts.push(options.jobDescriptionContext)
      return okResponse()
    },
  })
  const serialized = JSON.stringify(report)

  assert.equal(seenContexts.length, 2)
  assert.deepEqual(seenContexts[0], SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT)
  assert.deepEqual(seenContexts[1], SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT)
  assert.equal(serialized.includes(SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT.description), false)
  assert.equal(serialized.includes(SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT.requirements), false)
  assert.equal(serialized.includes(SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT.title), false)
})

test('AI nondeterminism harness safely emits null for unavailable telemetry fields', async () => {
  const report = await runAiScoringNondeterminismDiagnostics({
    runCount: 1,
    env: ENABLED_ENV,
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

test('Windows-safe direct execution helper and CLI invocation are covered', () => {
  assert.equal(isDirectExecution(), false)
  const result = spawnSync(process.execPath, ['backend/scripts/diagnoseAiScoringNondeterminism.local.mjs', '--runs', '1'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ENABLE_LOCAL_AI_SCORING_DIAGNOSTICS: 'true' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /single_provider_attempt_required_for_nondeterminism_mode/)
})
