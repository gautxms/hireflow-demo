export function buildCandidatesDirectoryQueryParams({ filters = {}, page = 1, pageSize = 25, sortBy = 'recent', sortDirection = 'desc' } = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (String(value || '').trim()) params.set(key, String(value).trim())
  })
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  params.set('sortBy', sortBy)
  params.set('sortDirection', sortDirection)
  return params
}

export function resolveCandidatesDirectoryUiState({ isLoading, error, hasCandidates, hasActiveFilters }) {
  const showLoadingState = Boolean(isLoading)
  const showErrorState = !isLoading && Boolean(error)
  const showEmptyWithoutFilters = !isLoading && !error && !hasCandidates && !hasActiveFilters
  const showEmptyWithFilters = !isLoading && !error && !hasCandidates && hasActiveFilters
  const showLoadedState = !isLoading && !error && hasCandidates

  return {
    showLoadingState,
    showErrorState,
    showEmptyWithoutFilters,
    showEmptyWithFilters,
    showLoadedState,
  }
}
