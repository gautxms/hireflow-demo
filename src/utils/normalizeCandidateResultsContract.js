const DEFAULT_REASON = 'Reasoning unavailable for this legacy analysis; score is derived from available profile signals.'

const toString = (value, fallback = '') => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

const toStringArray = (value) => {
  if (!Array.isArray(value)) return []
  return value.map((item) => toString(item, '').trim()).filter(Boolean)
}

const toBoundedScore = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, numeric))
}

export function resolveCandidateScore(rawCandidate = {}) {
  return rawCandidate?.matchScore?.score
    ?? rawCandidate?.matchScore
    ?? rawCandidate?.score
    ?? rawCandidate?.profile_score
    ?? rawCandidate?.scoreBreakdown?.overall
    ?? rawCandidate?.overall_score
    ?? rawCandidate?.overallScore
    ?? rawCandidate?.total_score
    ?? rawCandidate?.totalScore
    ?? 0
}

export function normalizeCandidateResultsContract(rawCandidate = {}, options = {}) {
  const index = options.index ?? 0
  const score = toBoundedScore(resolveCandidateScore(rawCandidate))
  const reason = toString(
    rawCandidate?.matchScore?.reason
      || rawCandidate?.fit_assessment?.reason
      || rawCandidate?.assessment?.summary
      || rawCandidate?.summary
      || DEFAULT_REASON,
    DEFAULT_REASON,
  ).trim() || DEFAULT_REASON

  const summary = toString(rawCandidate?.summary, '').trim() || 'Summary not available for this analysis.'
  const strengths = toStringArray(rawCandidate?.strengths)
  const considerations = toStringArray(rawCandidate?.considerations)

  return {
    ...rawCandidate,
    id: toString(rawCandidate?.id || rawCandidate?.resumeId || rawCandidate?.resume_id || `candidate-${index}`, `candidate-${index}`),
    name: toString(rawCandidate?.name || rawCandidate?.full_name || rawCandidate?.candidate_name || 'Candidate', 'Candidate'),
    score,
    matchScore: { score, reason },
    summary,
    strengths: strengths.length > 0 ? strengths : [reason],
    considerations: considerations.length > 0 ? considerations : [toString(rawCandidate?.fit_assessment?.risk || 'Review role-specific fit in interview.').trim()],
    top_skills: Array.isArray(rawCandidate?.top_skills) ? rawCandidate.top_skills : [],
    skills: Array.isArray(rawCandidate?.skills) || typeof rawCandidate?.skills === 'string' ? rawCandidate.skills : [],
    fit_assessment: rawCandidate?.fit_assessment && typeof rawCandidate.fit_assessment === 'object'
      ? {
          matched: Array.isArray(rawCandidate.fit_assessment.matched) ? rawCandidate.fit_assessment.matched : [],
          missing: Array.isArray(rawCandidate.fit_assessment.missing) ? rawCandidate.fit_assessment.missing : [],
          risk: toString(rawCandidate.fit_assessment.risk, '').trim(),
          uncertainty: toString(rawCandidate.fit_assessment.uncertainty, '').trim(),
          reason,
        }
      : { matched: [], missing: [], risk: '', uncertainty: '', reason },
  }
}
