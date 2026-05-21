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

const FAILURE_EVENT_RATE_LIMIT_MS = 30_000
const lastFailureEventByKey = new Map()

function resolveFieldType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function findFirstFailingField(candidate = null) {
  if (!candidate || typeof candidate !== 'object') return null
  const checks = [
    { path: 'matchScore', expected: ['object'] },
    { path: 'matchScore.score', expected: ['number', 'string'] },
    { path: 'matchScore.reason', expected: ['string'] },
    { path: 'experience', expected: ['array', 'string'] },
  ]

  for (const check of checks) {
    const segments = check.path.split('.')
    let current = candidate
    for (const segment of segments) {
      if (current == null || (typeof current !== 'object' && !Array.isArray(current))) {
        current = undefined
        break
      }
      current = current[segment]
    }

    const actualType = resolveFieldType(current)
    if (!check.expected.includes(actualType)) {
      return {
        path: check.path,
        expectedTypes: check.expected,
        actualType,
      }
    }
  }

  return null
}

export function buildResultsRenderErrorEvent({ analysisId = '', candidateCount = 0, normalizationStats = null, candidateFieldTypeSummary = null, selectedCandidateKey = '', selectedCandidateId = '', selectedCandidate = null, error = null, errorInfo = null, timestamp = new Date().toISOString() }) {
  const normalizedErrorFingerprint = normalizeErrorFingerprint({ error, errorInfo })

  return {
    eventType: 'analysis_detail_results_render_error',
    route: 'AnalysisDetail',
    analysisId: String(analysisId || ''),
    selectedCandidateKey: String(selectedCandidateKey || ''),
    selectedCandidateId: String(selectedCandidateId || ''),
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
    failingField: findFirstFailingField(selectedCandidate),
    diagnosticCode: 'RRB_RENDER_FAILURE',
    timestamp,
  }
}

export function logResultsRenderError(context) {
  const event = buildResultsRenderErrorEvent(context)
  const rateLimitKey = [
    event.analysisId,
    event.selectedCandidateKey || event.selectedCandidateId,
    event.normalizedErrorFingerprint,
  ].join('|')
  const now = Date.now()
  const lastEmittedAt = lastFailureEventByKey.get(rateLimitKey) || 0
  if (now - lastEmittedAt < FAILURE_EVENT_RATE_LIMIT_MS) {
    return null
  }
  lastFailureEventByKey.set(rateLimitKey, now)
  window.dispatchEvent(new CustomEvent('hireflow:telemetry', { detail: event }))
  console.error('[HireFlow] AnalysisDetail results render error', event)
  return event
}


export function logResultsPayloadCompatibilityIssues({ analysisId = '', issues = [], droppedCount = 0, inputCount = 0, outputCount = 0, timestamp = new Date().toISOString() } = {}) {
  const normalizedIssues = Array.isArray(issues) ? issues.slice(0, 25).map((issue, index) => ({
    index,
    code: String(issue?.code || ''),
    path: String(issue?.pathString || ''),
    candidateIndex: Number.isFinite(Number(issue?.candidateIndex)) ? Number(issue.candidateIndex) : null,
    expected: issue?.expected ?? null,
    received: issue?.received ?? null,
  })) : []

  const event = {
    eventType: 'analysis_detail_results_payload_compatibility',
    route: 'AnalysisDetail',
    diagnosticCode: 'RRB_PAYLOAD_COMPAT_ISSUES',
    analysisId: String(analysisId || ''),
    issueCount: normalizedIssues.length,
    issues: normalizedIssues,
    droppedCount: Number(droppedCount || 0),
    inputCount: Number(inputCount || 0),
    outputCount: Number(outputCount || 0),
    timestamp,
  }

  window.dispatchEvent(new CustomEvent('hireflow:telemetry', { detail: event }))
  console.warn('[HireFlow] AnalysisDetail payload compatibility issues', event)
  return event
}
