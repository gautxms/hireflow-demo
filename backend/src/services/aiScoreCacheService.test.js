import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SCORE_CACHE_NO_JD_SENTINEL,
  buildScoreCacheEligibilityDiagnostic,
  buildScoreCacheJobDescriptionFingerprint,
  buildScoreCacheKey,
  buildScoreCacheResumeFingerprint,
  buildScoreCacheValue,
  isAiScoreCacheEnabled,
} from './aiScoreCacheService.js'

const baseKeyInput = () => ({
  resumeFingerprint: buildScoreCacheResumeFingerprint({ canonicalResumeFields: { skills: ['js'], years: 5 } }),
  jobDescriptionFingerprint: buildScoreCacheJobDescriptionFingerprint({ jobDescription: 'Build APIs' }),
  provider: 'anthropic-primary',
  model: 'claude-test',
  promptVersion: 'resume-score-v1',
  compactMode: false,
})

test('same inputs produce same key', () => {
  assert.equal(buildScoreCacheKey(baseKeyInput()).key, buildScoreCacheKey(baseKeyInput()).key)
})

test('JD content change changes key', () => {
  const first = buildScoreCacheKey(baseKeyInput()).key
  const second = buildScoreCacheKey({
    ...baseKeyInput(),
    jobDescriptionFingerprint: buildScoreCacheJobDescriptionFingerprint({ jobDescription: 'Build data pipelines' }),
  }).key

  assert.notEqual(first, second)
})

test('prompt version, provider, model, compact mode, and contract version changes each change key', () => {
  const base = baseKeyInput()
  const baseKey = buildScoreCacheKey(base).key

  for (const override of [
    { promptVersion: 'resume-score-v2' },
    { provider: 'openai-secondary' },
    { model: 'different-model' },
    { compactMode: true },
    { scoringContractVersion: 'canonical_score_fields_v2' },
  ]) {
    assert.notEqual(buildScoreCacheKey({ ...base, ...override }).key, baseKey)
  }
})

test('missing resume fingerprint or JD fingerprint makes cache ineligible', () => {
  assert.deepEqual(buildScoreCacheKey({ ...baseKeyInput(), resumeFingerprint: null }).eligible, false)
  assert.deepEqual(buildScoreCacheKey({ ...baseKeyInput(), jobDescriptionFingerprint: null }).eligible, false)
})

test('no-JD sentinel only works if explicitly allowed', () => {
  assert.equal(buildScoreCacheJobDescriptionFingerprint({ jobDescription: '' }), null)
  assert.equal(
    buildScoreCacheJobDescriptionFingerprint({ jobDescription: '', allowNoJobDescription: true }),
    SCORE_CACHE_NO_JD_SENTINEL,
  )
})

test('value builder derives score_out_of_ten app-side', () => {
  assert.deepEqual(buildScoreCacheValue({ matchScore: { score: 82, score_out_of_ten: 2 } }), {
    scoring_contract_version: 'canonical_score_fields_v1',
    score: 82,
    score_out_of_ten: 8.2,
  })
})

test('value builder does not coerce null/blank/non-numeric values to 0', () => {
  for (const score of [null, '', ' ', 'not-a-number']) {
    assert.equal(buildScoreCacheValue({ matchScore: { score } }).score, null)
    assert.equal(buildScoreCacheValue({ matchScore: { score } }).score_out_of_ten, null)
  }
})

test('diagnostics contain no PII/raw text', () => {
  const diagnostic = buildScoreCacheEligibilityDiagnostic({
    ...baseKeyInput(),
    userId: 'user-1',
    analysisId: 'analysis-1',
    resumeText: 'Jane Candidate jane@example.com 555-1212',
    jobDescription: 'Secret raw JD',
    filename: 'jane-resume.pdf',
    rawProviderResponse: { score: 80 },
  }, { AI_SCORE_CACHE_ENABLED: 'true' })

  const serialized = JSON.stringify(diagnostic)
  assert.equal(serialized.includes('Jane'), false)
  assert.equal(serialized.includes('jane@example.com'), false)
  assert.equal(serialized.includes('555-1212'), false)
  assert.equal(serialized.includes('Secret raw JD'), false)
  assert.equal(serialized.includes('jane-resume.pdf'), false)
  assert.equal(serialized.includes('rawProviderResponse'), false)
})

test('feature flag disabled by default and enabled only by exact case-insensitive true', () => {
  assert.equal(isAiScoreCacheEnabled({}), false)
  assert.equal(isAiScoreCacheEnabled({ AI_SCORE_CACHE_ENABLED: 'false' }), false)
  assert.equal(isAiScoreCacheEnabled({ AI_SCORE_CACHE_ENABLED: '1' }), false)
  assert.equal(isAiScoreCacheEnabled({ AI_SCORE_CACHE_ENABLED: ' true ' }), false)
  assert.equal(isAiScoreCacheEnabled({ AI_SCORE_CACHE_ENABLED: 'TRUE' }), true)
})
