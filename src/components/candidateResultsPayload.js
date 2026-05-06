function normalizeCandidate(candidate = {}) {
  const rawScore = Number(candidate?.matchScore?.score ?? candidate?.matchScore ?? candidate?.score ?? candidate?.profile_score ?? 0)
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0
  const reason = String(
    candidate?.matchScore?.reason
    || candidate?.fit_assessment?.reason
    || candidate?.summary
    || 'Reasoning unavailable for this legacy analysis; score is derived from available profile signals.',
  ).trim()
  const strengths = Array.isArray(candidate?.strengths) && candidate.strengths.length > 0
    ? candidate.strengths
    : [reason]
  const considerations = Array.isArray(candidate?.considerations) && candidate.considerations.length > 0
    ? candidate.considerations
    : [candidate?.fit_assessment?.risk || 'Review role-specific fit in interview.']

  return {
    ...candidate,
    score,
    matchScore: {
      score,
      reason,
    },
    summary: String(candidate?.summary || 'Summary not available for this analysis.').trim(),
    strengths,
    considerations,
    top_skills: Array.isArray(candidate?.top_skills) ? candidate.top_skills : [],
    fit_assessment: candidate?.fit_assessment && typeof candidate.fit_assessment === 'object'
      ? {
          matched: Array.isArray(candidate.fit_assessment.matched) ? candidate.fit_assessment.matched : [],
          missing: Array.isArray(candidate.fit_assessment.missing) ? candidate.fit_assessment.missing : [],
          risk: String(candidate.fit_assessment.risk || '').trim(),
          uncertainty: String(candidate.fit_assessment.uncertainty || '').trim(),
          reason,
        }
      : { matched: [], missing: [], risk: '', uncertainty: '', reason },
  }
}

export function normalizeCandidateResultsPayload(payload) {
  if (Array.isArray(payload)) {
    return { candidates: payload.map((candidate) => normalizeCandidate(candidate)), parseMeta: {}, isInvalid: false }
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.candidates)) {
    return {
      candidates: payload.candidates.map((candidate) => normalizeCandidate(candidate)),
      parseMeta: payload.parseMeta && typeof payload.parseMeta === 'object' ? payload.parseMeta : {},
      isInvalid: false,
    }
  }

  return { candidates: [], parseMeta: {}, isInvalid: payload != null }
}
