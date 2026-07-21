import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAiScoringContractV2ScoreDeltaDiagnostic,
  buildScoreContractShadowDiagnostic,
  emitAiScoringContractV2ScoreDeltaDiagnostic,
  emitScoreContractShadowDiagnostic,
  isScoreContractShadowEnabled,
} from './scoreContractShadowDiagnostics.js'
import { SCORING_REGRESSION_FIXTURES } from './__fixtures__/scoringRegressionFixtures.js'

test('frozen regression fixtures preserve broad ranking, decimal experience, and requirement shapes', () => {
  const fixtures = SCORING_REGRESSION_FIXTURES
  assert.ok(fixtures.excellent.score > fixtures.strong.score)
  assert.ok(fixtures.strong.score > fixtures.moderate.score)
  assert.ok(fixtures.moderate.score > fixtures.low.score)
  assert.equal(fixtures.decimalInsideRange.years_experience, 4.5)
  assert.equal(fixtures.lowerBoundary.years_experience, fixtures.lowerBoundary.requirements.experience.min)
  assert.equal(fixtures.upperBoundary.years_experience, fixtures.upperBoundary.requirements.experience.max)
  assert.deepEqual(fixtures.alternativeTechnology.requirements.anyOf, ['technology-a', 'technology-b'])
  assert.deepEqual(fixtures.preferredQualification.requirements.required, ['core-skill'])
  assert.deepEqual(fixtures.preferredQualification.requirements.preferred, ['bonus-skill'])
  assert.equal(fixtures.noEducationRequirement.requirements.education, null)
  assert.equal(Object.isFrozen(fixtures), true)
  assert.equal(Object.isFrozen(fixtures.decimalInsideRange.requirements.experience), true)
})

test('no drift when score and matchScore.score match', () => {
  const diagnostic = buildScoreContractShadowDiagnostic({
    score: 82,
    matchScore: { score: 82, score_out_of_ten: 8.2 },
    fit_assessment: { overall_fit_score: 82 },
  })

  assert.equal(diagnostic.user_id, null)
  assert.equal(diagnostic.analysis_id, null)
  assert.equal(diagnostic.resume_id, null)
  assert.equal(diagnostic.provider, null)
  assert.equal(diagnostic.model, null)
  assert.equal(diagnostic.prompt_version, null)
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
    {
      userId: 'user-1',
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      provider: 'anthropic-primary',
      model: 'claude-test',
      promptVersion: '3',
    },
    { env: { SCORING_CONTRACT_V1_SHADOW: 'false' }, logger: { info: (...args) => logs.push(args) } },
  )

  assert.equal(result, null)
  assert.deepEqual(logs, [])
})

test('safe metadata appears in diagnostics when provided', () => {
  const diagnostic = buildScoreContractShadowDiagnostic(
    { resumeId: 'candidate-resume-fallback', score: 84, matchScore: { score: 84 } },
    {
      userId: 'user-1',
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      provider: 'anthropic-primary',
      model: 'claude-test',
      promptVersion: 3,
    },
  )

  assert.equal(diagnostic.user_id, 'user-1')
  assert.equal(diagnostic.analysis_id, 'analysis-1')
  assert.equal(diagnostic.resume_id, 'resume-1')
  assert.equal(diagnostic.provider, 'anthropic-primary')
  assert.equal(diagnostic.model, 'claude-test')
  assert.equal(diagnostic.prompt_version, '3')
})

test('missing metadata becomes null consistently', () => {
  const diagnostic = buildScoreContractShadowDiagnostic({ score: 84, matchScore: { score: 84 } })

  assert.equal(diagnostic.user_id, null)
  assert.equal(diagnostic.analysis_id, null)
  assert.equal(diagnostic.resume_id, null)
  assert.equal(diagnostic.provider, null)
  assert.equal(diagnostic.model, null)
  assert.equal(diagnostic.prompt_version, null)
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
    {
      userId: 'user-1',
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      provider: 'anthropic-primary',
      model: 'claude-test',
      promptVersion: '3',
    },
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
  assert.equal(result.user_id, 'user-1')
  assert.equal(result.analysis_id, 'analysis-1')
  assert.equal(result.resume_id, 'resume-1')
  assert.equal(result.provider, 'anthropic-primary')
  assert.equal(result.model, 'claude-test')
  assert.equal(result.prompt_version, '3')
  assert.equal(result.candidate_score_differs_from_match_score, true)
})

test('allowlist and sample rate gate shadow diagnostics', () => {
  assert.equal(isScoreContractShadowEnabled(
    { userId: 'blocked', analysisId: 'analysis-1' },
    { SCORING_CONTRACT_V1_SHADOW: 'true', SCORING_CONTRACT_V1_SHADOW_ALLOWED_USER_IDS: 'user-1' },
  ), false)

  assert.equal(isScoreContractShadowEnabled(
    {
      userId: 'user-1',
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      provider: 'anthropic-primary',
      model: 'claude-test',
      promptVersion: '3',
    },
    { SCORING_CONTRACT_V1_SHADOW: 'true', SCORING_CONTRACT_V1_SHADOW_SAMPLE_RATE: '0' },
    () => 0,
  ), false)
})

test('v2 score delta diagnostic uses displayed matchScore before stale candidate score', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 90,
      matchScore: { score: 70 },
      fit_assessment: { overall_fit_score: 75 },
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 78 },
    },
  })

  assert.equal(diagnostic.visible_score, 70)
  assert.equal(diagnostic.score_delta, 8)
  assert.equal(diagnostic.absolute_score_delta, 8)
  assert.equal(diagnostic.score_delta_direction, 'visible_lower_than_v2')
  assert.equal(diagnostic.score_delta_flagged, true)
})

test('v2 score delta diagnostic matches results route by using candidate score before fit assessment', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 88,
      fit_assessment: { overall_fit_score: 72 },
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 85.6 },
    },
  })

  assert.equal(diagnostic.visible_score, 88)
  assert.equal(diagnostic.visible_score_source, 'candidate.score')
  assert.equal(diagnostic.visible_fit_assessment_score, 72)
  assert.equal(diagnostic.score_delta, -2.4)
  assert.equal(diagnostic.absolute_score_delta, 2.4)
  assert.equal(diagnostic.score_delta_direction, 'visible_higher_than_v2')
  assert.equal(diagnostic.score_delta_flagged, false)
})

test('v2 score delta diagnostic uses candidate score as final visible-score fallback', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 82,
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 91.6 },
    },
  })

  assert.equal(diagnostic.visible_score, 82)
  assert.equal(diagnostic.score_delta, 9.6)
  assert.equal(diagnostic.absolute_score_delta, 9.6)
  assert.equal(diagnostic.score_delta_direction, 'visible_lower_than_v2')
  assert.equal(diagnostic.score_delta_flagged, true)
})

test('v2 score delta diagnostic flags visible score lower than v2 by at least seven points', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 82,
      matchScore: { score: 82 },
      fit_assessment: { overall_fit_score: 82 },
      ai_scoring_contract_v2: {
        weighted_total_score_recomputed: 91.6,
        has_job_description_context: true,
      },
    },
    parseDiagnostics: {
      extractionMethod: 'legacy_doc_word_extractor_semantic_text_scoring_experiment',
      normalizedTextCharCount: 3456,
    },
    fileExtension: 'doc',
  })

  assert.equal(diagnostic.visible_score, 82)
  assert.equal(diagnostic.v2_weighted_total_score_recomputed, 91.6)
  assert.equal(diagnostic.score_delta, 9.6)
  assert.equal(diagnostic.absolute_score_delta, 9.6)
  assert.equal(diagnostic.score_delta_direction, 'visible_lower_than_v2')
  assert.equal(diagnostic.score_delta_flagged, true)
  assert.equal(diagnostic.file_extension, 'doc')
  assert.equal(diagnostic.extraction_method, 'legacy_doc_word_extractor_semantic_text_scoring_experiment')
  assert.equal(diagnostic.normalizedTextCharCount, 3456)
  assert.equal(diagnostic.has_job_description_context, true)
  assert.equal(diagnostic.v2_shadow_present, true)
})

test('v2 score delta diagnostic does not flag Rahul-aligned shadow score', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 82,
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 81.3 },
    },
  })

  assert.equal(diagnostic.score_delta, -0.7)
  assert.equal(diagnostic.absolute_score_delta, 0.7)
  assert.equal(diagnostic.score_delta_direction, 'visible_higher_than_v2')
  assert.equal(diagnostic.score_delta_flagged, false)
})

test('v2 score delta diagnostic does not flag Vikram-aligned shadow score', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 52,
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 49.4 },
    },
  })

  assert.equal(diagnostic.score_delta, -2.6)
  assert.equal(diagnostic.absolute_score_delta, 2.6)
  assert.equal(diagnostic.score_delta_direction, 'visible_higher_than_v2')
  assert.equal(diagnostic.score_delta_flagged, false)
})

test('v2 score delta diagnostic remains backward compatible when v2 is missing', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: { score: 82 },
  })

  assert.equal(diagnostic.visible_score, 82)
  assert.equal(diagnostic.v2_weighted_total_score_recomputed, null)
  assert.equal(diagnostic.score_delta, null)
  assert.equal(diagnostic.absolute_score_delta, null)
  assert.equal(diagnostic.delta_direction, 'unknown')
  assert.equal(diagnostic.score_delta_flagged, false)
  assert.equal(diagnostic.v2_shadow_present, false)
})

test('v2 score delta diagnostic omits PII and free-form model text', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      name: 'Aisha Menon',
      email: 'aisha@example.com',
      phone: '555-0199',
      filename: 'aisha-resume.doc',
      originalFilename: 'Aisha Menon Resume.doc',
      reason: 'Free-form model rationale mentioning Acme Corp',
      model_reported_anomalies: ['Aisha Menon appears in free text'],
      score: 82,
      ai_scoring_contract_v2: {
        weighted_total_score_recomputed: 91.6,
        model_reported_anomalies: ['Aisha Menon appears in free text'],
      },
    },
    parseDiagnostics: {
      originalFilename: 'Aisha Menon Resume.doc',
      extractionMethod: 'legacy_doc_word_extractor_semantic_text_scoring_experiment',
    },
    fileExtension: 'doc',
  })

  const serialized = JSON.stringify(diagnostic)
  assert.doesNotMatch(serialized, /Aisha Menon|aisha@example\.com|555-0199|aisha-resume|Acme Corp|free text/i)
})

test('v2 score delta diagnostic logs only flagged safe fields', () => {
  const logs = []
  const unflagged = emitAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: { score: 82, ai_scoring_contract_v2: { weighted_total_score_recomputed: 81.3 } },
    logger: { info: (...args) => logs.push(args) },
  })
  assert.equal(unflagged.score_delta_flagged, false)
  assert.equal(logs.length, 1)
  assert.equal(logs[0][0], '[AiScoringContractV2] visible_vs_shadow_score_delta')

  const flagged = emitAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      name: 'Sensitive Name',
      email: 'sensitive@example.com',
      score: 82,
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 91.6, model_reported_anomalies: ['Sensitive Name'] },
    },
    parseDiagnostics: { extractionMethod: 'legacy_doc_word_extractor_semantic_text_scoring_experiment', normalizedTextCharCount: 3456 },
    fileExtension: 'doc',
    metadata: { analysisId: 'analysis-1', resumeId: 'resume-1', parseJobId: 'job-1', userId: 'user-1', hasJobDescriptionContext: true },
    logger: { info: (...args) => logs.push(args) },
  })

  assert.equal(flagged.score_delta_flagged, true)
  assert.equal(logs.length, 2)
  assert.equal(logs[1][0], '[AiScoringContractV2] visible_vs_shadow_score_delta')
  assert.deepEqual(logs[1][1], flagged)
  assert.doesNotMatch(JSON.stringify(logs[1]), /Sensitive Name|sensitive@example\.com|model_reported_anomalies/)
})

test('v2 visible-vs-shadow diagnostic emits delta bucket and direction when both scores exist', () => {
  const logs = []
  const diagnostic = emitAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      id: 'cand-1',
      score: 80,
      matchScore: { score: 80 },
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 84.4, weighted_total_score: 84, score_confidence: 'high', scoring_anomalies: [] },
    },
    parseDiagnostics: { normalizedTextFingerprint: 'safe-text-fp', extractionMethod: 'pdf_text' },
    metadata: { analysisId: 'analysis-1', resumeId: 'resume-1', parseJobId: 'job-1', originalFilename: 'private-name.pdf', provider: 'anthropic-primary', model: 'claude', promptVersion: 7, compactMode: true },
    fileExtension: 'pdf',
    logger: { info: (...args) => logs.push(args) },
  })

  assert.equal(logs[0][0], '[AiScoringContractV2] visible_vs_shadow_score_delta')
  assert.equal(diagnostic.visible_score, 80)
  assert.equal(diagnostic.v2_weighted_total_score_recomputed, 84.4)
  assert.equal(diagnostic.score_delta, 4.4)
  assert.equal(diagnostic.delta_bucket, '3_to_7')
  assert.equal(diagnostic.delta_direction, 'visible_lower_than_v2')
  assert.match(diagnostic.original_filename_fingerprint, /^[a-f0-9]{16}$/)
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-name\.pdf/)
})

test('v2 diagnostic emits safe skip reason when visible score is missing', () => {
  const logs = []
  const diagnostic = emitAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: { ai_scoring_contract_v2: { weighted_total_score_recomputed: 84.4 } },
    logger: { info: (...args) => logs.push(args) },
  })

  assert.equal(logs[0][0], '[AiScoringContractV2] visible_vs_shadow_score_delta_skipped')
  assert.equal(diagnostic.skip_reason, 'visible_score_missing')
  assert.equal(diagnostic.score_delta, null)
})

test('v2 diagnostic emits safe skip reason when v2 score is missing', () => {
  const logs = []
  const diagnostic = emitAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: { score: 84 },
    logger: { info: (...args) => logs.push(args) },
  })

  assert.equal(logs[0][0], '[AiScoringContractV2] visible_vs_shadow_score_delta_skipped')
  assert.equal(diagnostic.skip_reason, 'no_v2_contract')
  assert.equal(diagnostic.score_delta, null)
})

test('v2 score delta diagnostic uses normalized weighted_total_score_from_ai before legacy weighted_total_score', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 70,
      ai_scoring_contract_v2: {
        weighted_total_score_from_ai: 72.3,
        weighted_total_score: 99.9,
        weighted_total_score_recomputed: 72.6,
      },
    },
  })

  assert.equal(diagnostic.v2_weighted_total_score_from_ai, 72.3)
  assert.equal(diagnostic.v2_weighted_total_score_recomputed, 72.6)
})

test('v2 score delta diagnostic fingerprints provider-controlled candidate ids', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      id: 'aisha.menon@example.com',
      candidateId: 'Aisha-Menon-Resume',
      score: 70,
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 72.6 },
    },
    metadata: { candidateId: 'internal-candidate-123', originalFilename: 'Aisha-Menon-Resume.pdf' },
  })

  assert.equal(diagnostic.candidate_id, 'internal-candidate-123')
  assert.match(diagnostic.candidate_id_fingerprint, /^[a-f0-9]{16}$/)
  assert.match(diagnostic.original_filename_fingerprint, /^[a-f0-9]{16}$/)
  const serialized = JSON.stringify(diagnostic)
  assert.doesNotMatch(serialized, /aisha\.menon@example\.com/)
  assert.doesNotMatch(serialized, /Aisha-Menon-Resume/)
  assert.doesNotMatch(serialized, /Aisha-Menon-Resume\.pdf/)
})


test('v2 score delta diagnostic records displayed score source and raw visible fields', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 88,
      matchScore: { score: 78 },
      fitAssessment: { overallFitScore: 82 },
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 85.6 },
    },
  })

  assert.equal(diagnostic.visible_score, 78)
  assert.equal(diagnostic.visible_match_score, 78)
  assert.equal(diagnostic.visible_fit_assessment_score, 82)
  assert.equal(diagnostic.visible_candidate_score, 88)
  assert.equal(diagnostic.visible_score_source, 'matchScore.score')
  assert.equal(diagnostic.score_delta, 7.6)
  assert.equal(diagnostic.score_delta_direction, 'visible_lower_than_v2')
  assert.equal(diagnostic.score_delta_bucket, '7_to_12')
  assert.equal(diagnostic.score_delta_flagged, true)
})

test('v2 diagnostic identifies the displayed scoring source without storing resume content', () => {
  const candidate = {
    id: 'synthetic-candidate',
    name: 'Private Name',
    email: 'private@example.test',
    score: 84,
    matchScore: { score: 84, reason: 'Sensitive resume evidence' },
    v2_visible_score_experiment: {
      original_visible_score: 79,
      applied_score: 84,
      contract_version: 'ai_jd_fit_rubric_v2',
    },
    ai_scoring_contract_v2: {
      scoring_contract_version: 'ai_jd_fit_rubric_v2',
      weighted_total_score_recomputed: 84,
      score_confidence: 'high',
      skills_match_score: 86,
      relevant_experience_score: 82,
      category_breakdown: { 'private@example.test': 'Sensitive resume evidence' },
    },
  }

  const before = structuredClone(candidate)
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({ candidate })

  assert.equal(diagnostic.original_ai_score, 79)
  assert.equal(diagnostic.v2_score, 84)
  assert.equal(diagnostic.displayed_score, 84)
  assert.equal(diagnostic.displayed_score_source, 'ai_scoring_contract_v2')
  assert.equal(diagnostic.displayed_scoring_version, 'ai_jd_fit_rubric_v2')
  assert.equal(diagnostic.v2_confidence, 'high')
  assert.deepEqual(diagnostic.v2_category_breakdown, {
    skills_match_score: 86,
    relevant_experience_score: 82,
  })
  assert.deepEqual(candidate, before)
  assert.doesNotMatch(JSON.stringify(diagnostic), /Private Name|private@example|Sensitive resume evidence/)
})

test('score-source characterization follows production visible-score precedence and experiment order', () => {
  const cases = [
    {
      name: 'legacy visible score with unapplied V2 shadow',
      candidate: {
        matchScore: { score: 71 },
        score: 71,
        ai_scoring_contract_v2: {
          scoring_contract_version: 'ai_jd_fit_rubric_v2',
          weighted_total_score_recomputed: 86,
        },
      },
      expected: { score: 71, source: 'matchScore.score', version: null, original: 71 },
    },
    {
      name: 'deterministic visible score only',
      candidate: {
        matchScore: { score: 83 },
        score: 83,
        deterministic_jd_fit_apply_metadata: {
          original_ai_score: 76,
          applied_deterministic_score: 83,
          scoring_contract_version: 'deterministic_jd_fit_v1',
        },
      },
      expected: { score: 83, source: 'deterministic_jd_fit', version: 'deterministic_jd_fit_v1', original: 76 },
    },
    {
      name: 'V2 visible score only',
      candidate: {
        matchScore: { score: 87 },
        score: 87,
        v2_visible_score_experiment: {
          original_visible_score: 78,
          applied_score: 87,
          contract_version: 'ai_jd_fit_rubric_v2',
        },
        ai_scoring_contract_v2: { weighted_total_score_recomputed: 87 },
      },
      expected: { score: 87, source: 'ai_scoring_contract_v2', version: 'ai_jd_fit_rubric_v2', original: 78 },
    },
    {
      name: 'V2 is visible when deterministic and V2 both applied',
      candidate: {
        matchScore: { score: 89 },
        score: 89,
        deterministic_jd_fit_apply_metadata: {
          original_ai_score: 74,
          applied_deterministic_score: 82,
          scoring_contract_version: 'deterministic_jd_fit_v1',
        },
        v2_visible_score_experiment: {
          original_visible_score: 82,
          applied_score: 89,
          contract_version: 'ai_jd_fit_rubric_v2',
        },
        ai_scoring_contract_v2: { weighted_total_score_recomputed: 89 },
      },
      expected: { score: 89, source: 'ai_scoring_contract_v2', version: 'ai_jd_fit_rubric_v2', original: 74 },
    },
    {
      name: 'candidate without experiment metadata',
      candidate: { matchScore: { score: 69 }, score: 91 },
      expected: { score: 69, source: 'matchScore.score', version: null, original: 69 },
    },
    {
      name: 'conflicting fields use matchScore and ignore stale experiment metadata',
      candidate: {
        matchScore: { score: 62 },
        score: 91,
        fit_assessment: { overall_fit_score: 88 },
        v2_visible_score_experiment: {
          original_visible_score: 70,
          applied_score: 91,
          contract_version: 'ai_jd_fit_rubric_v2',
        },
      },
      expected: { score: 62, source: 'matchScore.score', version: null, original: 70 },
    },
    {
      name: 'missing fields remain missing',
      candidate: {},
      expected: { score: null, source: 'missing', version: null, original: null },
    },
  ]

  for (const entry of cases) {
    const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({ candidate: entry.candidate })
    assert.equal(diagnostic.displayed_score, entry.expected.score, `${entry.name}: score`)
    assert.equal(diagnostic.displayed_score_source, entry.expected.source, `${entry.name}: source`)
    assert.equal(diagnostic.displayed_scoring_version, entry.expected.version, `${entry.name}: version`)
    assert.equal(diagnostic.original_ai_score, entry.expected.original, `${entry.name}: original`)
  }
})

test('v2 score delta diagnostic does not emit main event with null score_delta', () => {
  const logs = []
  const visibleMissing = emitAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: { ai_scoring_contract_v2: { weighted_total_score_recomputed: 85.6 } },
    logger: { info: (...args) => logs.push(args) },
  })
  const v2Missing = emitAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: { matchScore: { score: 78 }, ai_scoring_contract_v2: {} },
    logger: { info: (...args) => logs.push(args) },
  })

  assert.equal(visibleMissing.score_delta, null)
  assert.equal(v2Missing.score_delta, null)
  assert.equal(logs.length, 2)
  assert.equal(logs[0][0], '[AiScoringContractV2] visible_vs_shadow_score_delta_skipped')
  assert.equal(logs[1][0], '[AiScoringContractV2] visible_vs_shadow_score_delta_skipped')
})


test('v2 score delta diagnostic emits safe token-budget retry metadata', () => {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: {
      score: 88,
      ai_scoring_contract_v2: { weighted_total_score_recomputed: 85.6 },
    },
    metadata: {
      tokenBudgetAttemptCount: 2,
      tokenBudgetRetryCount: 1,
      finalTokenBudgetMaxOutputTokens: 3600,
      finalTokenBudgetMode: 'truncation_safe',
    },
  })

  assert.equal(diagnostic.token_budget_attempt_count, 2)
  assert.equal(diagnostic.token_budget_retry_count, 1)
  assert.equal(diagnostic.final_token_budget_max_output_tokens, 3600)
  assert.equal(diagnostic.final_token_budget_mode, 'truncation_safe')
})

test('v2 score delta diagnostic treats Vikram drift examples as expected', () => {
  const drifted = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: { matchScore: { score: 78 }, ai_scoring_contract_v2: { weighted_total_score_recomputed: 85.6 } },
  })
  const aligned = buildAiScoringContractV2ScoreDeltaDiagnostic({
    candidate: { matchScore: { score: 88 }, ai_scoring_contract_v2: { weighted_total_score_recomputed: 85.6 } },
  })

  assert.equal(drifted.score_delta, 7.6)
  assert.equal(drifted.score_delta_direction, 'visible_lower_than_v2')
  assert.equal(drifted.score_delta_flagged, true)
  assert.equal(aligned.score_delta, -2.4)
  assert.equal(aligned.score_delta_direction, 'visible_higher_than_v2')
  assert.equal(aligned.score_delta_flagged, false)
})
