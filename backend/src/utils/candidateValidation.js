const FAILURE_PLACEHOLDER_PATTERNS = [
  'could not be parsed',
  'unable to extract',
  'corrupted',
  'unreadable',
  'compressed/encrypted',
  'binary content',
  'pdf content',
]

export function isFailurePlaceholderCandidate(candidate = {}) {
  const name = String(candidate?.name || '').trim().toLowerCase()
  const merged = [
    candidate?.summary,
    candidate?.reasoning,
    candidate?.matchScore?.reason,
    candidate?.parseError,
    candidate?.parse_error,
  ].map((value) => String(value || '').toLowerCase()).join(' ')
  const hasFailureText = FAILURE_PLACEHOLDER_PATTERNS.some((pattern) => merged.includes(pattern))
  return name === 'unknown candidate' && hasFailureText
}

function resolveRawScore(candidate = {}) {
  if (candidate?.score != null) return Number(candidate.score)
  if (candidate?.matchScore?.score != null) return Number(candidate.matchScore.score)
  if (candidate?.profile_score != null) return Number(candidate.profile_score)
  if (typeof candidate?.matchScore !== 'object') return Number(candidate.matchScore)
  return Number.NaN
}

function resolveReasoning(candidate = {}) {
  return String(candidate?.matchScore?.reason || candidate?.reasoning || candidate?.summary || '').trim()
}

export function isCandidateExtractionValid(candidate = {}) {
  if (!candidate || typeof candidate !== 'object') return false
  return !isFailurePlaceholderCandidate(candidate)
}

export function isCandidateScoringValid(candidate = {}) {
  const rawScore = resolveRawScore(candidate)
  const reasoning = resolveReasoning(candidate)
  return Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 100 && Boolean(reasoning)
}

export function isCandidateValidForScoredOutcome(candidate = {}) {
  return isCandidateExtractionValid(candidate) && isCandidateScoringValid(candidate)
}
