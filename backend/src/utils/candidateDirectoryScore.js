function normalizeNullableNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function clampScore(value) {
  const numeric = normalizeNullableNumber(value)
  if (numeric === null) return null
  return Math.max(0, Math.min(100, numeric))
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function resolveScoreValue(candidate, source) {
  if (!candidate || typeof candidate !== 'object') return null
  if (source === 'matchScore.score') {
    return candidate.matchScore && typeof candidate.matchScore === 'object'
      ? normalizeNullableNumber(candidate.matchScore.score)
      : null
  }
  if (source === 'matchScore') {
    return typeof candidate.matchScore === 'object' ? null : normalizeNullableNumber(candidate.matchScore)
  }
  if (source === 'scoreBreakdown.overall') {
    return candidate.scoreBreakdown && typeof candidate.scoreBreakdown === 'object'
      ? normalizeNullableNumber(candidate.scoreBreakdown.overall)
      : null
  }
  return normalizeNullableNumber(candidate[source])
}

function hasJobContext(candidate, metadata) {
  if (metadata?.sourceJobId) return true
  if (!candidate || typeof candidate !== 'object') return false
  if (candidate.jobDescriptionContextUsed === true) return true
  if (candidate.jobDescriptionContext?.hasContext === true) return true
  if (candidate.jobDescriptionId || candidate.job_description_id || candidate.jobId || candidate.job_id) return true
  return candidate.matchScore !== undefined && candidate.matchScore !== null
}

export function resolveCandidateDirectoryScore(candidate, metadata = {}) {
  const profile = candidate && typeof candidate === 'object' ? candidate : {}
  const jdContext = hasJobContext(profile, metadata)
  const jdSources = [
    'matchScore.score',
    'matchScore',
    'score',
    'scoreBreakdown.overall',
    'overall_score',
    'overallScore',
    'total_score',
    'totalScore',
    'profile_score',
  ]
  const profileOnlySources = ['profile_score', 'score', 'scoreBreakdown.overall', 'overall_score', 'overallScore', 'total_score', 'totalScore']
  const sources = jdContext ? jdSources : profileOnlySources

  for (const source of sources) {
    if (source === 'profile_score' && !hasOwn(profile, 'profile_score')) continue
    const value = resolveScoreValue(profile, source)
    if (value !== null) {
      const raw = clampScore(value)
      const context = jdContext
        ? (source === 'profile_score' ? 'legacy' : 'jd_fit')
        : (source === 'profile_score' ? 'profile_only' : 'legacy')
      const display = (raw / 10).toFixed(1)
      return {
        raw,
        display,
        unit: 'raw_0_100',
        displayUnit: 'out_of_10',
        source,
        context,
        sourceParseJobId: metadata.sourceParseJobId || null,
        sourceJobId: metadata.sourceJobId || null,
        sourceUpdatedAt: metadata.sourceUpdatedAt || null,
      }
    }
  }

  return {
    raw: null,
    display: null,
    unit: 'raw_0_100',
    displayUnit: 'out_of_10',
    source: 'missing',
    context: 'missing',
    sourceParseJobId: metadata.sourceParseJobId || null,
    sourceJobId: metadata.sourceJobId || null,
    sourceUpdatedAt: metadata.sourceUpdatedAt || null,
  }
}
