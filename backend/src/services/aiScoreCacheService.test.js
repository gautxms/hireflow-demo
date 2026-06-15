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
  compactMode: 'standard',
})

test('same inputs produce same key', () => {
  assert.equal(buildScoreCacheKey(baseKeyInput()).key, buildScoreCacheKey(baseKeyInput()).key)
})

test('blank and empty resume sources do not produce fingerprints', () => {
  for (const input of [
    { extractedText: '   ' },
    { canonicalResumeFields: {} },
    { parsedResume: [] },
    { canonicalResumeFields: { skills: [], summary: ' ', experience: [{ bullets: ['  '], metadata: {} }] } },
    { parsedResume: [{ nested: { empty: [] } }, ' '] },
  ]) {
    assert.equal(buildScoreCacheResumeFingerprint(input), null)
  }
})

test('non-empty nested resume source produces fingerprint', () => {
  assert.ok(buildScoreCacheResumeFingerprint({ canonicalResumeFields: { experience: [{ title: 'Engineer' }] } }))
})

test('JD content change changes key', () => {
  const first = buildScoreCacheKey(baseKeyInput()).key
  const second = buildScoreCacheKey({
    ...baseKeyInput(),
    jobDescriptionFingerprint: buildScoreCacheJobDescriptionFingerprint({ jobDescription: 'Build data pipelines' }),
  }).key

  assert.notEqual(first, second)
})

test('structured JD fingerprints are stable for reordered keys and change with content', () => {
  const first = buildScoreCacheJobDescriptionFingerprint({
    jobDescription: { title: 'Engineer', requirements: ['Node', 'SQL'], location: { remote: true, region: 'US' } },
  })
  const reordered = buildScoreCacheJobDescriptionFingerprint({
    jobDescription: { location: { region: 'US', remote: true }, requirements: ['Node', 'SQL'], title: 'Engineer' },
  })
  const changed = buildScoreCacheJobDescriptionFingerprint({
    jobDescription: { title: 'Engineer', requirements: ['Node', 'Python'], location: { remote: true, region: 'US' } },
  })

  assert.equal(first, reordered)
  assert.notEqual(first, changed)
})

test('blank and empty JD sources do not produce fingerprints or stringify objects', () => {
  for (const jobDescription of [' ', {}, [], { title: ' ', requirements: [{}] }]) {
    assert.equal(buildScoreCacheJobDescriptionFingerprint({ jobDescription }), null)
  }

  assert.notEqual(buildScoreCacheJobDescriptionFingerprint({ jobDescription: { title: 'Engineer' } }), '[object Object]')
})

test('prompt version, provider, model, compact mode, and contract version changes each change key', () => {
  const base = baseKeyInput()
  const baseKey = buildScoreCacheKey(base).key

  for (const override of [
    { promptVersion: 'resume-score-v2' },
    { provider: 'openai-secondary' },
    { model: 'different-model' },
    { compactMode: 'compact' },
    { scoringContractVersion: 'canonical_score_fields_v2' },
  ]) {
    assert.notEqual(buildScoreCacheKey({ ...base, ...override }).key, baseKey)
  }
})

test('compact mode preserves exact safe mode instead of collapsing to boolean', () => {
  const compact = buildScoreCacheKey({ ...baseKeyInput(), compactMode: 'compact' })
  const minimal = buildScoreCacheKey({ ...baseKeyInput(), compactMode: 'minimal' })
  const bareMinimum = buildScoreCacheKey({ ...baseKeyInput(), compactMode: 'bare_minimum' })

  assert.equal(compact.material.compact_mode, 'compact')
  assert.equal(minimal.material.compact_mode, 'minimal')
  assert.equal(bareMinimum.material.compact_mode, 'bare_minimum')
  assert.notEqual(compact.key, minimal.key)
  assert.notEqual(compact.key, bareMinimum.key)
  assert.notEqual(minimal.key, bareMinimum.key)
})

test('missing or blank compact mode makes cache ineligible', () => {
  assert.equal(buildScoreCacheKey({ ...baseKeyInput(), compactMode: null }).eligible, false)
  assert.equal(buildScoreCacheKey({ ...baseKeyInput(), compactMode: '   ' }).eligible, false)
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

test('value builder derives canonical score fields and score_out_of_ten app-side', () => {
  assert.deepEqual(buildScoreCacheValue({
    matchScore: { score: 82, score_out_of_ten: 2 },
    canonical_score_source: 'matchScore.score',
    canonical_score_context: 'jd_fit',
  }), {
    scoring_contract_version: 'canonical_score_fields_v1',
    canonical_score: 82,
    score: 82,
    score_out_of_ten: 8.2,
    canonical_score_source: 'matchScore.score',
    canonical_score_context: 'jd_fit',
  })
})

test('value builder supports primitive matchScore', () => {
  const value = buildScoreCacheValue({ matchScore: 82 })

  assert.equal(value.canonical_score, 82)
  assert.equal(value.score, 82)
  assert.equal(value.score_out_of_ten, 8.2)
})

test('value builder can use metadata source and context fallbacks', () => {
  const value = buildScoreCacheValue({ matchScore: 75 }, {
    canonicalScoreSource: 'matchScore.score',
    canonicalScoreContext: 'jd_fit',
  })

  assert.equal(value.canonical_score_source, 'matchScore.score')
  assert.equal(value.canonical_score_context, 'jd_fit')
})

test('value builder does not coerce null/blank/non-numeric values to 0', () => {
  for (const score of [null, '', ' ', 'not-a-number']) {
    assert.equal(buildScoreCacheValue({ matchScore: { score } }).canonical_score, null)
    assert.equal(buildScoreCacheValue({ matchScore: { score } }).score, null)
    assert.equal(buildScoreCacheValue({ matchScore: { score } }).score_out_of_ten, null)
  }
})

test('diagnostics and key/value outputs contain no PII/raw text', () => {
  const keyResult = buildScoreCacheKey(baseKeyInput())
  const diagnostic = buildScoreCacheEligibilityDiagnostic({
    ...baseKeyInput(),
    userId: 'user-1',
    analysisId: 'analysis-1',
    resumeText: 'Jane Candidate jane@example.com 555-1212',
    jobDescription: 'Secret raw JD',
    filename: 'jane-resume.pdf',
    rawProviderResponse: { score: 80 },
  }, { AI_SCORE_CACHE_ENABLED: 'true' })
  const value = buildScoreCacheValue({
    matchScore: { score: 80 },
    canonical_score_source: 'Jane Candidate jane@example.com 555-1212',
    canonical_score_context: 'jane-resume.pdf',
    rawProviderResponse: { score: 80 },
  }, {
    resumeText: 'Jane Candidate jane@example.com 555-1212',
    jobDescription: 'Secret raw JD',
  })

  for (const output of [keyResult, diagnostic, value]) {
    const serialized = JSON.stringify(output)
    assert.equal(serialized.includes('Jane'), false)
    assert.equal(serialized.includes('jane@example.com'), false)
    assert.equal(serialized.includes('555-1212'), false)
    assert.equal(serialized.includes('Secret raw JD'), false)
    assert.equal(serialized.includes('jane-resume.pdf'), false)
    assert.equal(serialized.includes('rawProviderResponse'), false)
  }
})

test('feature flag disabled by default and enabled only by exact case-insensitive true', () => {
  assert.equal(isAiScoreCacheEnabled({}), false)
  assert.equal(isAiScoreCacheEnabled({ AI_SCORE_CACHE_ENABLED: 'false' }), false)
  assert.equal(isAiScoreCacheEnabled({ AI_SCORE_CACHE_ENABLED: '1' }), false)
  assert.equal(isAiScoreCacheEnabled({ AI_SCORE_CACHE_ENABLED: ' true ' }), false)
  assert.equal(isAiScoreCacheEnabled({ AI_SCORE_CACHE_ENABLED: 'TRUE' }), true)
})
