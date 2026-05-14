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
 *   failedResumes?: unknown[]
 * }
 *
 * Normalized CandidateResults contract (output):
 * {
 *   candidates: Array<Record<string, unknown> & { id: string, name: string, score: number, matchScore: number }>
 *   droppedCount: number
 *   inputCount: number
 *   outputCount: number
 *   hasInvalidPayload: boolean
 *   hasPartiallyInvalidPayload: boolean
 *   parseMeta: Record<string, unknown>
 *   failedResumes: unknown[]
 * }
 */

function normalizeFiniteNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function clampText(value, fallback, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return fallback
  return normalized.slice(0, maxLength)
}

function normalizeEvidenceSnippets(snippets) {
  if (!Array.isArray(snippets)) {
    return [{ quote: 'No supporting evidence snippets are available.', section: '', span: '' }]
  }

  const normalized = snippets
    .map((snippet) => {
      if (!snippet || typeof snippet !== 'object') return null
      return {
        quote: clampText(snippet.quote, 'No supporting evidence snippets are available.', 280),
        section: clampText(snippet.section, '', 80),
        span: clampText(snippet.span, '', 80),
      }
    })
    .filter(Boolean)

  return normalized.length > 0
    ? normalized.slice(0, 5)
    : [{ quote: 'No supporting evidence snippets are available.', section: '', span: '' }]
}

function normalizeResumeIntegrityFlags(flags) {
  if (!Array.isArray(flags)) return []
  return flags
    .map((flag) => {
      if (!flag || typeof flag !== 'object') return null
      return {
        issueType: clampText(flag.issueType ?? flag.issue_type, 'general_parsing_concern', 80),
        severity: ['low', 'medium', 'high'].includes(String(flag.severity || '').toLowerCase())
          ? String(flag.severity).toLowerCase()
          : 'low',
        label: clampText(flag.label, 'Potential issue', 120),
        evidence: clampText(flag.evidence, 'Needs recruiter review', 240),
        recruiterAction: clampText(flag.recruiterAction ?? flag.recruiter_action, 'Needs recruiter review', 180),
        confidence: Math.max(0, Math.min(1, normalizeFiniteNumber(flag.confidence, 0.5))),
        source: clampText(flag.source, 'ai_assisted', 40),
      }
    })
    .filter(Boolean)
    .slice(0, 8)
}

function normalizeCandidate(candidate, index) {
  if (!candidate || typeof candidate !== 'object') {
    return { normalized: null, issue: { code: 'candidate.invalid_type', path: ['candidates', index], expected: 'object', received: typeof candidate } }
  }

  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `candidate-${index}`
  const name = typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name
    : (candidate.name == null ? 'Candidate' : String(candidate.name))

  return {
    normalized: {
      ...candidate,
      id,
      name,
      score: normalizeFiniteNumber(candidate.score, 0),
      matchScore: normalizeFiniteNumber(candidate.matchScore, normalizeFiniteNumber(candidate.score, 0)),
      evidenceSnippets: normalizeEvidenceSnippets(candidate.evidenceSnippets),
      resumeIntegrityFlags: normalizeResumeIntegrityFlags(candidate.resumeIntegrityFlags),
      uncertaintyItems: Array.isArray(candidate.uncertaintyItems) && candidate.uncertaintyItems.length > 0
        ? candidate.uncertaintyItems.slice(0, 3).map((item) => clampText(item, 'Needs recruiter review', 140))
        : ['No uncertainty markers were provided. Re-run analysis for richer risk flags.'],
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
    failedResumes: Array.isArray(rawPayload?.failedResumes) ? rawPayload.failedResumes : [],
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
