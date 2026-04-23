import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildResultsQueryParams,
  hasRenderableCandidates,
  normalizeCandidateForResults,
  normalizeNumericRange,
  normalizeSortBy,
  paginateCandidates,
  resolveCandidateResumeUuid,
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
