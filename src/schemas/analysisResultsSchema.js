const isNonProductionBuild = (() => {
  if (typeof process !== 'undefined' && process?.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return true
})()

/**
 * Analysis results schema contract shared by frontend and backend teams.
 *
 * Raw payload contract (input):
 * {
 *   candidates: unknown[]
 *   droppedCount?: number
 *   inputCount?: number
 *   outputCount?: number
 *   hasInvalidPayload?: boolean
 *   hasPartiallyInvalidPayload?: boolean
 *   parseMeta?: Record<string, unknown>
 * }
 *
 * Normalized CandidateResults contract (output):
 * {
 *   candidates: Array<Record<string, unknown> & { id: string, name: string, score: number, matchScore: { score: number, reason: string } }>
 *   droppedCount: number
 *   inputCount: number
 *   outputCount: number
 *   hasInvalidPayload: boolean
 *   hasPartiallyInvalidPayload: boolean
 *   parseMeta: Record<string, unknown>
 * }
 */

function normalizeFiniteNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function resolveCandidateScore(candidate) {
  if (Number.isFinite(Number(candidate?.score))) {
    return Number(candidate.score)
  }

  if (Number.isFinite(Number(candidate?.matchScore?.score))) {
    return Number(candidate.matchScore.score)
  }

  if (Number.isFinite(Number(candidate?.matchScore))) {
    return Number(candidate.matchScore)
  }

  return 0
}

function normalizeMatchScore(candidate, score) {
  const reason = String(
    candidate?.matchScore?.reason
    || candidate?.fit_assessment?.reason
    || candidate?.summary
    || 'Reasoning unavailable for this legacy analysis; score is derived from available profile signals.',
  ).trim()

  return {
    score,
    reason: reason || 'Reasoning unavailable for this legacy analysis; score is derived from available profile signals.',
  }
}

function normalizeCandidate(candidate, index) {
  if (!candidate || typeof candidate !== 'object') {
    return { normalized: null, issue: { code: 'candidate.invalid_type', path: ['candidates', index], expected: 'object', received: typeof candidate } }
  }

  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `candidate-${index}`
  const name = typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name
    : (candidate.name == null ? 'Candidate' : String(candidate.name))

  const score = resolveCandidateScore(candidate)

  return {
    normalized: {
      ...candidate,
      id,
      name,
      score,
      matchScore: normalizeMatchScore(candidate, score),
    },
    issue: null,
  }
}

export function validateAnalysisResultsPayload(rawPayload, { logger = console } = {}) {
  const issues = []

  if (!rawPayload || typeof rawPayload !== 'object') {
    issues.push({ code: 'payload.invalid_type', path: [], expected: 'object', received: typeof rawPayload })
  }

  const sourceCandidates = Array.isArray(rawPayload?.candidates) ? rawPayload.candidates : []
  if (!Array.isArray(rawPayload?.candidates)) {
    issues.push({ code: 'payload.candidates.invalid_type', path: ['candidates'], expected: 'array', received: typeof rawPayload?.candidates })
  }

  const normalizedCandidates = []
  sourceCandidates.forEach((candidate, index) => {
    const { normalized, issue } = normalizeCandidate(candidate, index)
    if (issue) {
      issues.push(issue)
      return
    }
    normalizedCandidates.push(normalized)
  })

  const inputCount = normalizeFiniteNumber(rawPayload?.inputCount, sourceCandidates.length)
  const outputCount = normalizedCandidates.length
  const droppedCount = Math.max(0, normalizeFiniteNumber(rawPayload?.droppedCount, sourceCandidates.length - outputCount))

  const normalizedPayload = {
    candidates: normalizedCandidates,
    inputCount,
    outputCount,
    droppedCount,
    hasInvalidPayload: outputCount === 0 && inputCount > 0,
    hasPartiallyInvalidPayload: outputCount > 0 && droppedCount > 0,
    parseMeta: rawPayload?.parseMeta && typeof rawPayload.parseMeta === 'object' ? rawPayload.parseMeta : {},
  }

  if (issues.length > 0) {
    logger.error('[AnalysisResultsSchema] Validation issues detected.', {
      issueCount: issues.length,
      issues,
      fallbackApplied: true,
      candidateInputCount: sourceCandidates.length,
      candidateOutputCount: outputCount,
    })
  }

  return {
    payload: normalizedPayload,
    issues,
    isValid: issues.length === 0,
  }
}

export { isNonProductionBuild }
