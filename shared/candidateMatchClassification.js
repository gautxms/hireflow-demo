export function normalizeCandidateMatchScore(score) {
  if (score === null || score === undefined || (typeof score === 'string' && score.trim() === '')) return null
  const numeric = Number(score)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  const tenPointScore = numeric > 10 ? numeric / 10 : numeric
  return Math.max(0, Math.min(10, tenPointScore))
}

export function resolveCandidateMatchTier(score) {
  const normalized = normalizeCandidateMatchScore(score)
  if (normalized === null) return 'unscored'
  if (normalized >= 8) return 'strong'
  if (normalized >= 6) return 'possible'
  return 'low'
}

export function resolveCandidateMatchLabel(score) {
  const tier = resolveCandidateMatchTier(score)
  if (tier === 'strong') return 'Strong match'
  if (tier === 'possible') return 'Possible match'
  if (tier === 'low') return 'Low match'
  return 'Unable to score'
}
