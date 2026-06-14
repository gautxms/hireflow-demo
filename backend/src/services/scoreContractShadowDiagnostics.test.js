import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildScoreContractShadowDiagnostic,
  emitScoreContractShadowDiagnostic,
  isScoreContractShadowEnabled,
} from './scoreContractShadowDiagnostics.js'

test('no drift when score and matchScore.score match', () => {
  const diagnostic = buildScoreContractShadowDiagnostic({
    score: 82,
    matchScore: { score: 82, score_out_of_ten: 8.2 },
    fit_assessment: { overall_fit_score: 82 },
  })

  assert.equal(diagnostic.candidate_score_differs_from_match_score, false)
  assert.equal(diagnostic.fit_score_differs_from_match_score, false)
  assert.equal(diagnostic.model_out_of_ten_differs_from_app_derived, false)
  assert.equal(diagnostic.scoring_contract_version, 'shadow_v1')
})

test('drift when fit_assessment.overall_fit_score differs from matchScore.score', () => {
  const diagnostic = buildScoreContractShadowDiagnostic({
    score: 74,
    matchScore: { score: 74 },
    fit_assessment: { overall_fit_score: 68 },
  })

  assert.equal(diagnostic.fit_score, 68)
  assert.equal(diagnostic.match_score, 74)
  assert.equal(diagnostic.fit_score_differs_from_match_score, true)
})

test('drift when model-authored score_out_of_ten differs from app-derived score / 10', () => {
  const diagnostic = buildScoreContractShadowDiagnostic({
    matchScore: { score: 72, score_out_of_ten: 8.2 },
  })

  assert.equal(diagnostic.app_derived_score_out_of_ten, 7.2)
  assert.equal(diagnostic.model_out_of_ten_differs_from_app_derived, true)
})

test('missing match score with profile_score present flags fallback risk', () => {
  const diagnostic = buildScoreContractShadowDiagnostic({
    score: null,
    matchScore: null,
    profile_score: 91,
  })

  assert.equal(diagnostic.role_fit_score_missing, true)
  assert.equal(diagnostic.profile_score_used_as_fallback, true)
  assert.equal(diagnostic.profile_score, 91)
})

test('Candidate Directory profileScore remains resume-only and separate from role-fit score', () => {
  const diagnostic = buildScoreContractShadowDiagnostic({
    score: 80,
    matchScore: { score: 80 },
    profileScore: 93,
  })

  assert.equal(diagnostic.match_score, 80)
  assert.equal(diagnostic.profile_score, 93)
  assert.equal(diagnostic.current_results_score_resolution, 'matchScore.score')
  assert.equal(diagnostic.current_directory_profile_score_resolution, 'profileScore')
})

test('null/blank/non-numeric values do not become 0', () => {
  const diagnostic = buildScoreContractShadowDiagnostic({
    score: '',
    matchScore: { score: 'not-a-number', score_out_of_ten: ' ' },
    fit_assessment: { overall_fit_score: undefined },
    profile_score: 'NaN',
  })

  assert.equal(diagnostic.candidate_score, null)
  assert.equal(diagnostic.match_score, null)
  assert.equal(diagnostic.model_authored_score_out_of_ten, null)
  assert.equal(diagnostic.app_derived_score_out_of_ten, null)
  assert.equal(diagnostic.fit_score, null)
  assert.equal(diagnostic.profile_score, null)
})

test('utility does not mutate input', () => {
  const candidate = Object.freeze({
    score: 79,
    matchScore: Object.freeze({ score: 79, score_out_of_ten: 7.9 }),
    fit_assessment: Object.freeze({ overall_fit_score: 79 }),
  })

  const before = JSON.stringify(candidate)
  buildScoreContractShadowDiagnostic(candidate)
  assert.equal(JSON.stringify(candidate), before)
})

test('with flag disabled, no shadow logging occurs', () => {
  const logs = []
  const result = emitScoreContractShadowDiagnostic(
    { score: 70, matchScore: { score: 70 } },
    { userId: 'user-1', analysisId: 'analysis-1' },
    { env: { SCORING_CONTRACT_V1_SHADOW: 'false' }, logger: { info: (...args) => logs.push(args) } },
  )

  assert.equal(result, null)
  assert.deepEqual(logs, [])
})

test('with flag enabled and allowlist matched, safe shadow diagnostics are emitted', () => {
  const logs = []
  const result = emitScoreContractShadowDiagnostic(
    {
      name: 'Sensitive Name',
      email: 'sensitive@example.com',
      phone: '555-0100',
      rawResumeText: 'private resume text',
      score: 72,
      matchScore: { score: 82, score_out_of_ten: 7.2 },
      fit_assessment: { overall_fit_score: 82 },
    },
    { userId: 'user-1', analysisId: 'analysis-1' },
    {
      env: {
        SCORING_CONTRACT_V1_SHADOW: 'true',
        SCORING_CONTRACT_V1_SHADOW_ALLOWED_USER_IDS: 'user-1',
        SCORING_CONTRACT_V1_SHADOW_ALLOWED_ANALYSIS_IDS: 'analysis-1',
      },
      logger: { info: (...args) => logs.push(args) },
      random: () => 0,
    },
  )

  assert.equal(logs.length, 1)
  assert.deepEqual(result, logs[0][1])
  const serialized = JSON.stringify(logs[0])
  assert.doesNotMatch(serialized, /Sensitive Name|sensitive@example\.com|555-0100|private resume text/)
  assert.equal(result.candidate_score_differs_from_match_score, true)
})

test('allowlist and sample rate gate shadow diagnostics', () => {
  assert.equal(isScoreContractShadowEnabled(
    { userId: 'blocked', analysisId: 'analysis-1' },
    { SCORING_CONTRACT_V1_SHADOW: 'true', SCORING_CONTRACT_V1_SHADOW_ALLOWED_USER_IDS: 'user-1' },
  ), false)

  assert.equal(isScoreContractShadowEnabled(
    { userId: 'user-1', analysisId: 'analysis-1' },
    { SCORING_CONTRACT_V1_SHADOW: 'true', SCORING_CONTRACT_V1_SHADOW_SAMPLE_RATE: '0' },
    () => 0,
  ), false)
})
