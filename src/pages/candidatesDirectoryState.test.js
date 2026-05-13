import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCandidatesDirectoryQueryParams, resolveCandidatesDirectoryUiState } from './candidatesDirectoryState.js'

test('resolveCandidatesDirectoryUiState returns mutually exclusive flags for loading/error/empty/loaded states', () => {
  const scenarios = [
    { input: { isLoading: true, error: '', hasCandidates: false, hasActiveFilters: false }, expected: 'showLoadingState' },
    { input: { isLoading: false, error: 'boom', hasCandidates: true, hasActiveFilters: true }, expected: 'showErrorState' },
    { input: { isLoading: false, error: '', hasCandidates: false, hasActiveFilters: false }, expected: 'showEmptyWithoutFilters' },
    { input: { isLoading: false, error: '', hasCandidates: false, hasActiveFilters: true }, expected: 'showEmptyWithFilters' },
    { input: { isLoading: false, error: '', hasCandidates: true, hasActiveFilters: false }, expected: 'showLoadedState' },
  ]

  for (const scenario of scenarios) {
    const state = resolveCandidatesDirectoryUiState(scenario.input)
    const truthyCount = Object.values(state).filter(Boolean).length
    assert.equal(truthyCount, 1)
    assert.equal(state[scenario.expected], true)
  }
})

test('buildCandidatesDirectoryQueryParams aligns filters, pagination, and sort query params', () => {
  const params = buildCandidatesDirectoryQueryParams({
    filters: {
      search: '  jane doe ',
      job: ' Staff Engineer ',
      skills: 'React,Node',
      sourceJobId: 'job_42',
      sourceAnalysisId: ' ',
    },
    page: 3,
    pageSize: 50,
    sortBy: 'score',
    sortDirection: 'asc',
  })

  assert.equal(params.get('search'), 'jane doe')
  assert.equal(params.get('job'), 'Staff Engineer')
  assert.equal(params.get('skills'), 'React,Node')
  assert.equal(params.get('sourceJobId'), 'job_42')
  assert.equal(params.get('sourceAnalysisId'), null)
  assert.equal(params.get('page'), '3')
  assert.equal(params.get('pageSize'), '50')
  assert.equal(params.get('sortBy'), 'score')
  assert.equal(params.get('sortDirection'), 'asc')
})
