import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCandidateDirectoryQueryParams, normalizeCandidateDirectoryQuery } from './candidateDirectoryQuerySchema.js'

test('buildCandidateDirectoryQueryParams serializes out-of-10 score filters without conversion', () => {
  const params = new URLSearchParams(buildCandidateDirectoryQueryParams({ scoreMin: '8.0', scoreUnit: 'out_of_10' }))

  assert.equal(params.get('scoreMin'), '8')
  assert.equal(params.get('scoreUnit'), 'out_of_10')
})

test('buildCandidateDirectoryQueryParams omits empty score filters and invalid score metadata', () => {
  const params = new URLSearchParams(buildCandidateDirectoryQueryParams({ scoreMin: '', scoreMax: 'Infinity', scoreUnit: 'bad' }))

  assert.equal(params.has('scoreMin'), false)
  assert.equal(params.has('scoreMax'), false)
  assert.equal(params.has('scoreUnit'), false)
})

test('buildCandidateDirectoryQueryParams preserves existing non-score filters', () => {
  const params = new URLSearchParams(buildCandidateDirectoryQueryParams({ search: 'Ada', skills: 'React', sourceJobId: 'job-1', page: '2' }))

  assert.equal(params.get('search'), 'Ada')
  assert.equal(params.get('skills'), 'React')
  assert.equal(params.get('sourceJobId'), 'job-1')
  assert.equal(params.get('page'), '2')
})

test('normalizeCandidateDirectoryQuery accepts only supported score units', () => {
  assert.equal(normalizeCandidateDirectoryQuery({ scoreUnit: 'out_of_10' }).scoreUnit, 'out_of_10')
  assert.equal(normalizeCandidateDirectoryQuery({ scoreUnit: 'raw_0_100' }).scoreUnit, 'raw_0_100')
  assert.equal(normalizeCandidateDirectoryQuery({ scoreUnit: 'display' }).scoreUnit, null)
})
