export function buildFailedAnalysisState(errorMessage) {
  return {
    message: 'Analysis failed',
    detail: String(errorMessage || 'Unable to analyze resumes'),
    actions: ['retry', 'fallback_provider', 'contact_support'],
  }
}

export function resolveSafeAnalyzeRoute(routeState) {
  const currentPage = String(routeState?.currentPage || '').trim()
  if (!currentPage) {
    return 'uploader'
  }

  const validPages = new Set(['landing', 'uploader', 'results', 'dashboard', 'settings'])
  return validPages.has(currentPage) ? currentPage : 'uploader'
}
