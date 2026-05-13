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
  toDisplayText,
  toSafeScore,
  resolveCandidateBasics,
  resolveCandidateFit,
  resolveCandidateResumeMetadata,
  resolveCandidateScoring,
  resolveCandidateSkills,
} from './candidateResultsState.js'

test('normalizeSortBy whitelists supported values', () => {
  assert.equal(normalizeSortBy('name'), 'name_asc')
  assert.equal(normalizeSortBy('experience'), 'experience_desc')
  assert.equal(normalizeSortBy('bad-value'), 'best_match')
})

test('buildResultsQueryParams serializes query state for share/export', () => {
  const params = buildResultsQueryParams({
    searchText: 'alice',
    selectedSkills: ['React', 'Node'],
    expRange: { min: '3', max: '8' },
    matchRange: { min: '70', max: '99' },
    sortBy: 'experience_desc',
    page: 2,
    pageSize: 10,
  })

  assert.equal(params.get('search'), 'alice')
  assert.equal(params.get('skills'), 'React,Node')
  assert.equal(params.get('experienceMin'), '3')
  assert.equal(params.get('matchMax'), '99')
  assert.equal(params.get('sortBy'), 'experience_desc')
  assert.equal(params.get('page'), '2')
})

test('normalizeCandidateForResults builds deterministic bulk key when IDs are missing', () => {
  const candidate = { name: 'Alex Rivera', email: 'alex@example.com', phone: '555-0000', createdAt: '2025-01-02' }
  const first = normalizeCandidateForResults(candidate, 0)
  const second = normalizeCandidateForResults(candidate, 99)
  assert.equal(first._bulkKey, second._bulkKey)
})


test('normalizeCandidateForResults uses index fallback when stable identity fields are absent', () => {
  const first = normalizeCandidateForResults({}, 0)
  const second = normalizeCandidateForResults({}, 1)
  assert.notEqual(first._bulkKey, second._bulkKey)
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

test('resolver bundle returns safe defaults and availability flags without throwing', () => {
  const candidate = { skills: { tools_and_platforms: ['React'] }, scoreBreakdown: { overall: 82 } }
  const basics = resolveCandidateBasics(candidate)
  const scoring = resolveCandidateScoring(candidate)
  const fit = resolveCandidateFit(candidate)
  const skills = resolveCandidateSkills(candidate)
  const resume = resolveCandidateResumeMetadata(candidate)

  assert.equal(basics.title, 'N/A')
  assert.equal(scoring.scoreBreakdownAvailable, true)
  assert.equal(scoring.scoreBreakdownProvenance, 'analysis_payload')
  assert.equal(fit.fitAssessmentAvailable, false)
  assert.equal(skills.relevantSkillsAvailable, true)
  assert.equal(skills.matchedSkillsAvailable, false)
  assert.equal(resume.resumeUrlAvailable, false)
})

test('resolveCandidateBasics derives current title from experience[0].title and formats education arrays safely', () => {
  const basics = resolveCandidateBasics({
    experience: [{ title: 'Staff Engineer' }],
    education: [
      { degree: 'B.S. Computer Science', school: 'UT Austin' },
      'AWS Certified Developer',
    ],
  })

  assert.equal(basics.title, 'Staff Engineer')
  assert.equal(basics.education, 'B.S. Computer Science — UT Austin, AWS Certified Developer')
})
