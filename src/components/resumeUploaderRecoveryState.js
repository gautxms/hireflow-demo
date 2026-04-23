export function buildFailedAnalysisState(errorMessage) {
  const hasSpecificMessage = Boolean(String(errorMessage || '').trim())
  return {
    message: 'Analysis failed',
    detail: hasSpecificMessage
      ? 'We could not analyze resumes right now. Please retry.'
      : 'Unable to analyze resumes. Please retry.',
    actions: ['retry', 'contact_support'],
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
