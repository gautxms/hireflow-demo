import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDirectoryResponse } from './candidates.js'

test('buildDirectoryResponse includes both legacy and new contract fields with safe defaults', () => {
  const candidates = [{ resumeId: '1' }, { resumeId: '2' }]
  const filtersApplied = { skills: [], sourceJobId: null, sourceAnalysisId: null }

  const response = buildDirectoryResponse(candidates, filtersApplied, {})

  assert.equal(response.total, 2)
  assert.equal(response.totalCount, 2)
  assert.equal(response.page, 1)
  assert.equal(response.pageSize, 2)
  assert.equal(response.totalPages, 1)
  assert.equal(response.sortBy, 'sourceUpdatedAt')
  assert.equal(response.sortDirection, 'desc')
  assert.deepEqual(response.candidates, candidates)
  assert.deepEqual(response.filtersApplied, filtersApplied)
})

test('buildDirectoryResponse honors provided pagination and sort params', () => {
  const candidates = [{ resumeId: '1' }, { resumeId: '2' }, { resumeId: '3' }, { resumeId: '4' }, { resumeId: '5' }]
  const response = buildDirectoryResponse(candidates, {}, {
    page: '2',
    pageSize: '2',
    sortBy: 'name',
    sortDirection: 'asc',
  })

  assert.equal(response.total, 5)
  assert.equal(response.totalCount, 5)
  assert.equal(response.page, 2)
  assert.equal(response.pageSize, 2)
  assert.equal(response.totalPages, 3)
  assert.equal(response.sortBy, 'name')
  assert.equal(response.sortDirection, 'asc')
  assert.deepEqual(response.candidates, [{ resumeId: '3' }, { resumeId: '4' }])
})
