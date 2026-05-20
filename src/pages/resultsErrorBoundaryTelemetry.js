export function normalizeErrorFingerprint({ error = null, errorInfo = null } = {}) {
  const name = String(error?.name || 'Error').trim().toLowerCase()
  const message = String(error?.message || 'Unknown render error')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  const stack = String(errorInfo?.componentStack || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 400)

  return `${name}|${message}|${stack}`
}

export function buildResultsRenderErrorEvent({ analysisId = '', candidateCount = 0, normalizationStats = null, candidateFieldTypeSummary = null, error = null, errorInfo = null, timestamp = new Date().toISOString() }) {
  const normalizedErrorFingerprint = normalizeErrorFingerprint({ error, errorInfo })

  return {
    eventType: 'analysis_detail_results_render_error',
    route: 'AnalysisDetail',
    analysisId: String(analysisId || ''),
    candidateCount: Number(candidateCount || 0),
    normalizationStats: normalizationStats && typeof normalizationStats === 'object'
      ? {
        inputCount: Number(normalizationStats.inputCount || 0),
        droppedCount: Number(normalizationStats.droppedCount || 0),
      }
      : null,
    candidateFieldTypeSummary: Array.isArray(candidateFieldTypeSummary)
      ? candidateFieldTypeSummary.map((entry, index) => ({
        index: Number(entry?.index ?? index),
        id: String(entry?.id || ''),
        matchScoreType: String(entry?.matchScoreType || ''),
        matchScoreScoreType: String(entry?.matchScoreScoreType || ''),
        matchScoreReasonType: String(entry?.matchScoreReasonType || ''),
        experienceType: String(entry?.experienceType || ''),
      }))
      : [],
    errorName: error?.name || 'Error',
    errorMessage: error?.message || 'Unknown render error',
    componentStack: errorInfo?.componentStack || '',
    normalizedErrorFingerprint,
    diagnosticCode: 'RRB_RENDER_FAILURE',
    timestamp,
  }
}

export function logResultsRenderError(context) {
  const event = buildResultsRenderErrorEvent(context)
  window.dispatchEvent(new CustomEvent('hireflow:telemetry', { detail: event }))
  console.error('[HireFlow] AnalysisDetail results render error', event)
  return event
}
