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

  if (Number.isFinite(Number(candidate?.profile_score))) {
    return Number(candidate.profile_score)
  }

  return 0
}

function toIssuePath(pathSegments = []) {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) return '$'
  return pathSegments.reduce((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`
    return acc === '$' ? `$.${segment}` : `${acc}.${segment}`
  }, '$')
}

function createIssue({ code, path = [], candidateIndex = null, expected, received, message }) {
  return {
    code,
    path,
    pathString: toIssuePath(path),
    candidateIndex,
    expected,
    received,
    message,
  }
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
    return { normalized: null, issues: [createIssue({ code: 'candidate.invalid_type', path: ['candidates', index], expected: 'object', received: typeof candidate, candidateIndex: index })] }
  }

  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `candidate-${index}`
  const name = typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name
    : (candidate.name == null ? 'Candidate' : String(candidate.name))

  const score = Math.max(0, Math.min(100, resolveCandidateScore(candidate)))
  const toStringArray = (value) => (Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [])

  const candidateIssues = []
  if (candidate.matchScore !== undefined && candidate.matchScore !== null) {
    const isValidMatchScoreObject = typeof candidate.matchScore === 'object' && Number.isFinite(Number(candidate?.matchScore?.score))
    const isValidMatchScoreNumber = Number.isFinite(Number(candidate.matchScore))
    if (!isValidMatchScoreObject && !isValidMatchScoreNumber) {
      candidateIssues.push(createIssue({
        code: 'candidate.match_score.invalid_shape',
        path: ['candidates', index, 'matchScore'],
        expected: 'number | { score: number, reason?: string }',
        received: candidate.matchScore === null ? 'null' : typeof candidate.matchScore,
        candidateIndex: index,
      }))
    }
  }

  if (candidate.profile_score !== undefined && score === 0 && !Number.isFinite(Number(candidate?.score))) {
    candidateIssues.push(createIssue({
      code: 'candidate.profile_score.unresolved',
      path: ['candidates', index, 'profile_score'],
      expected: 'finite numeric source to resolve score',
      received: candidate.profile_score,
      candidateIndex: index,
      message: 'profile_score was provided but score resolved to 0; score sources may be malformed.',
    }))
  }

  return {
    normalized: {
      ...candidate,
      id,
      name,
      score,
      matchScore: normalizeMatchScore(candidate, score),
      summary: String(candidate?.summary ?? '').trim(),
      title: String(candidate?.title ?? '').trim(),
      location: String(candidate?.location ?? '').trim(),
      skills: toStringArray(candidate?.skills),
      top_skills: toStringArray(candidate?.top_skills),
      strengths: toStringArray(candidate?.strengths),
      considerations: toStringArray(candidate?.considerations),
    },
    issues: candidateIssues,
  }
}

export function validateAnalysisResultsPayload(rawPayload, { logger = console, strict = isNonProductionBuild } = {}) {
  const issues = []

  if (!rawPayload || typeof rawPayload !== 'object') {
    issues.push(createIssue({ code: 'payload.invalid_type', path: [], expected: 'object', received: typeof rawPayload }))
  }

  const sourceCandidates = Array.isArray(rawPayload?.candidates) ? rawPayload.candidates : []
  if (!Array.isArray(rawPayload?.candidates)) {
    issues.push(createIssue({ code: 'payload.candidates.invalid_type', path: ['candidates'], expected: 'array', received: typeof rawPayload?.candidates }))
  }

  const normalizedCandidates = []
  sourceCandidates.forEach((candidate, index) => {
    const { normalized, issues: candidateIssues } = normalizeCandidate(candidate, index)
    if (!normalized) {
      issues.push(...candidateIssues)
      return
    }
    if (strict && candidateIssues.length > 0) {
      issues.push(...candidateIssues)
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
    const logLevel = strict ? 'error' : 'warn'
    logger[logLevel]('[AnalysisResultsSchema] Validation issues detected.', {
      issueCount: issues.length,
      issues,
      strict,
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
