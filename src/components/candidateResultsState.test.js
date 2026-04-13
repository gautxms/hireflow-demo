import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildResultsQueryParams,
  normalizeNumericRange,
  normalizeSortBy,
  paginateCandidates,
  resolveCandidateResumeUuid,
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
