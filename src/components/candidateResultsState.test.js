import test from 'node:test'
import assert from 'node:assert/strict'
import { CANDIDATE_RESULTS_PAYLOAD_FIXTURES } from './__fixtures__/candidateResultsPayloadFixtures.js'
import {
  buildResultsQueryParams,
  hasRenderableCandidates,
  normalizeCandidateForResults,
  normalizeNumericRange,
  normalizeSortBy,
  paginateCandidates,
  buildCandidateRenderContract,
  resolveCandidateResumeUuid,
  resolveCandidateKey,
  resolveActiveCandidateScore,
  sanitizeExpandedCandidate,
  buildExpandedCandidateViewModel,
  toDisplayText,
  toSafeScore,
} from './candidateResultsState.js'

test('normalizeSortBy whitelists supported values', () => {
  assert.equal(normalizeSortBy('name'), 'name')
  assert.equal(normalizeSortBy('bad-value'), 'match_score')
})

test('buildResultsQueryParams serializes query state for share/export', () => {
  const params = buildResultsQueryParams({
    searchText: 'alice',
    selectedSkills: ['React', 'Node'],
    expRange: { min: '3', max: '8' },
    matchRange: { min: '70', max: '99' },
    sortBy: 'experience',
    page: 2,
    pageSize: 10,
  })

  assert.equal(params.get('search'), 'alice')
  assert.equal(params.get('skills'), 'React,Node')
  assert.equal(params.get('experienceMin'), '3')
  assert.equal(params.get('matchMax'), '99')
  assert.equal(params.get('page'), '2')
})

test('pagination clamps page and returns page metadata', () => {
  const { rows, pagination } = paginateCandidates([{ id: 1 }, { id: 2 }, { id: 3 }], 5, 2)
  assert.equal(rows.length, 1)
  assert.equal(pagination.page, 2)
  assert.equal(pagination.totalPages, 2)
})

test('normalizeNumericRange swaps inverted bounds', () => {
  const range = normalizeNumericRange({ min: '90', max: '20' })
  assert.deepEqual(range, { min: '20', max: '90' })
})

test('resolveCandidateResumeUuid only returns valid UUID values', () => {
  const resumeUuid = '8ac357c6-8872-4f0f-bf34-8ba8720faacd'
  assert.equal(resolveCandidateResumeUuid({ resumeId: resumeUuid }), resumeUuid)
  assert.equal(resolveCandidateResumeUuid({ id: 'parsed-1' }), null)
  assert.equal(resolveCandidateResumeUuid({ resume_id: '123' }), null)
})

test('resolveCandidateKey prefers stable candidate identity fields', () => {
  assert.equal(resolveCandidateKey({ candidateKey: 'key-1', id: 'id-1' }, 0), 'key-1')
  assert.equal(resolveCandidateKey({ resumeId: 'resume-2', id: 'id-2' }, 0), 'resume-2')
  assert.equal(resolveCandidateKey({ id: 'id-3' }, 0), 'id-3')
  assert.equal(resolveCandidateKey({ email: 'a@b.com' }, 0), 'a@b.com')
  assert.equal(resolveCandidateKey({ name: 'Alex' }, 4), 'Alex-4')
})



test('resolveCandidateKey appends index when name is the only available identifier', () => {
  assert.equal(resolveCandidateKey({ name: 'Alex' }, 0), 'Alex-0')
  assert.equal(resolveCandidateKey({ name: 'Alex' }, 1), 'Alex-1')
})
test('resolveCandidateKey uses index only as final fallback for mixed/partial payloads', () => {
  assert.equal(resolveCandidateKey({ id: '', resumeId: null, resume_id: undefined, email: '', name: 'Taylor' }, 2), 'Taylor-2')
  assert.equal(resolveCandidateKey({ id: '', resumeId: null, resume_id: undefined, email: '', name: '' }, 7), 'candidate-7')
  assert.equal(resolveCandidateKey({}, 9), 'candidate-9')
})

test('toDisplayText normalizes object/array candidate fields into safe renderable text', () => {
  assert.equal(toDisplayText({ text: 'Senior engineer' }), 'Senior engineer')
  assert.equal(toDisplayText({ value: 'Remote' }), 'Remote')
  assert.equal(toDisplayText({ nested: true }, 'No summary available'), 'No summary available')
  assert.equal(toDisplayText(['React', { text: 'Node.js' }, 7]), 'React, Node.js, 7')
})

test('toSafeScore constrains malformed or out-of-range values for chart rendering', () => {
  assert.equal(toSafeScore({ score: 90 }, 0), 0)
  assert.equal(toSafeScore('95'), 95)
  assert.equal(toSafeScore(999), 100)
  assert.equal(toSafeScore(-12), 0)
})

test('hasRenderableCandidates allows mixed-validity arrays when at least one candidate is valid', () => {
  const mixedCandidates = [
    null,
    normalizeCandidateForResults(undefined, 0),
    normalizeCandidateForResults({ id: 'c-1', name: 'Valid User', skills: null }, 1),
  ]

  assert.equal(hasRenderableCandidates(mixedCandidates), true)
})

test('normalizeCandidateForResults defaults malformed skills to empty string', () => {
  const normalized = normalizeCandidateForResults({ id: 'c-2', skills: { primary: 'React' } }, 0)
  assert.equal(normalized.skills, '')
  assert.equal(normalized._isRenderable, true)
})

test('hasRenderableCandidates returns false when no valid candidate objects exist', () => {
  assert.equal(hasRenderableCandidates([]), false)
  assert.equal(hasRenderableCandidates([null, undefined]), false)
})


test('buildCandidateRenderContract returns stable display fields for legacy payload candidates', () => {
  const [legacyCandidate] = CANDIDATE_RESULTS_PAYLOAD_FIXTURES.legacyPayload
  const contract = buildCandidateRenderContract(legacyCandidate)

  assert.deepEqual(contract, {
    name: 'Alex Rivera',
    location: 'Austin, TX',
    yearsExperience: '6 yrs exp',
    score: 88,
    scoreTenPoint: '8.8',
    scoreTier: 'strong',
    topSkills: ['React', 'Node.js', 'TypeScript'],
  })
})

test('resolveActiveCandidateScore supports multiple backend score field variants', () => {
  assert.equal(resolveActiveCandidateScore({ matchScore: { score: 92 } }), 92)
  assert.equal(resolveActiveCandidateScore({ matchScore: 87 }), 87)
  assert.equal(resolveActiveCandidateScore({ score: 78 }), 78)
  assert.equal(resolveActiveCandidateScore({ profile_score: 71 }), 71)
  assert.equal(resolveActiveCandidateScore({ scoreBreakdown: { overall: 66 } }), 66)
  assert.equal(resolveActiveCandidateScore({ score: 'not-a-number' }), null)
})

test('no-diff gate: buildCandidateRenderContract score-related fields are identical for legacy and modern payload variants', () => {
  const [legacyCandidate] = CANDIDATE_RESULTS_PAYLOAD_FIXTURES.legacyPayload
  const [modernCandidate] = CANDIDATE_RESULTS_PAYLOAD_FIXTURES.modernPayload

  const legacyContract = buildCandidateRenderContract(legacyCandidate)
  const modernContract = buildCandidateRenderContract(modernCandidate)

  assert.deepEqual(
    {
      score: legacyContract.score,
      scoreTenPoint: legacyContract.scoreTenPoint,
      scoreTier: legacyContract.scoreTier,
      yearsExperience: legacyContract.yearsExperience,
      topSkills: legacyContract.topSkills,
    },
    {
      score: modernContract.score,
      scoreTenPoint: modernContract.scoreTenPoint,
      scoreTier: modernContract.scoreTier,
      yearsExperience: modernContract.yearsExperience,
      topSkills: modernContract.topSkills,
    },
  )
})


test('sanitizeExpandedCandidate preserves numeric matchScore for score resolution compatibility', () => {
  const sanitized = sanitizeExpandedCandidate({
    matchScore: 87,
  })

  assert.equal(sanitized.matchScore, 87)
  assert.equal(resolveActiveCandidateScore(sanitized), 87)
})

test('sanitizeExpandedCandidate strictly defaults arrays, nested objects, and display fields', () => {
  const sanitized = sanitizeExpandedCandidate({
    name: { first: 'Sam' },
    summary: 123,
    skills: { primary: 'React' },
    top_skills: [null, ' React '],
    fit_assessment: { missing: 'TypeScript', reason: ['good'] },
    scoreBreakdown: new Map([['overall', 82]]),
    experience: [{ title: 'Engineer' }, null],
  })

  assert.equal(sanitized.name, 'Candidate')
  assert.equal(sanitized.summary, '123')
  assert.deepEqual(sanitized.skills, [])
  assert.deepEqual(sanitized.top_skills, ['React'])
  assert.deepEqual(sanitized.fit_assessment.missing, [])
  assert.equal(sanitized.fit_assessment.reason, 'good')
  assert.deepEqual(sanitized.scoreBreakdown, {})
  assert.deepEqual(sanitized.experience, [{ title: 'Engineer' }, {}])
})

test('buildExpandedCandidateDrawerViewModel normalizes malformed candidate shapes safely', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    name: { first: 'Bad' },
    summary: { nested: { nope: true } },
    strengths: null,
    considerations: [{ reason: 'x' }],
    matchedSkills: null,
    missingSkills: null,
    fit_assessment: { missing: { wrong: true } },
    experience: [{ title: { wrong: true } }],
  })

  assert.equal(vm.isUnavailable, false)
  assert.equal(vm.candidateName, 'Candidate')
  assert.equal(Array.isArray(vm.matchedSkills), true)
  assert.equal(Array.isArray(vm.missingSkills), true)
  assert.equal(Array.isArray(vm.candidateConsiderations), true)
})

test('buildExpandedCandidateDrawerViewModel returns compact unavailable state on unexpected throw', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const circular = {}
  circular.self = circular
  Object.defineProperty(circular, 'name', { get() { throw new Error('boom') } })

  const vm = buildExpandedCandidateDrawerViewModel(circular)
  assert.equal(vm.isUnavailable, true)
  assert.equal(vm.summaryText, 'Candidate details unavailable')
  assert.equal(vm.unavailableMessage, 'Candidate details unavailable')
})


test('buildExpandedCandidateDrawerViewModel derives high confidence from numeric confidenceScores.fit_assessment', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidenceScores: { fit_assessment: 0.9 },
  })

  assert.equal(vm.confidenceLabel, 'High confidence')
})

test('buildExpandedCandidateDrawerViewModel derives moderate confidence from numeric confidence.fit_assessment', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidence: { fit_assessment: 0.75 },
  })

  assert.equal(vm.confidenceLabel, 'Moderate confidence')
})

test('buildExpandedCandidateDrawerViewModel derives low confidence from numeric confidenceScores.fit_assessment', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidenceScores: { fit_assessment: 0.45 },
  })

  assert.equal(vm.confidenceLabel, 'Low confidence')
})

test('buildExpandedCandidateDrawerViewModel preserves historical explicit textual confidence label', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
    fit_assessment: { confidence: 'Moderate confidence' },
    confidenceScores: { fit_assessment: 0.9 },
  })

  assert.equal(vm.confidenceLabel, 'Moderate confidence')
})


test('buildExpandedCandidateDrawerViewModel ignores null/blank numeric confidence placeholders', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')

  const withNull = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidenceScores: { fit_assessment: null },
  })
  assert.equal(withNull.confidenceLabel, '')

  const withBlankString = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidenceScores: { fit_assessment: '' },
  })
  assert.equal(withBlankString.confidenceLabel, '')
})
test('buildExpandedCandidateDrawerViewModel safely handles missing confidence payloads', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
  })

  assert.equal(vm.confidenceLabel, '')
})
