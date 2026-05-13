function normalizeCandidate(candidate = {}) {
  const fitAssessment = candidate?.fit_assessment && typeof candidate.fit_assessment === 'object'
    ? candidate.fit_assessment
    : {}

  const matchedRequirements = Array.isArray(fitAssessment.matched_requirements) ? fitAssessment.matched_requirements : []
  const missingRequirements = Array.isArray(fitAssessment.missing_requirements)
    ? fitAssessment.missing_requirements
    : Array.isArray(candidate?.missingRequirements)
      ? candidate.missingRequirements
      : Array.isArray(candidate?.missing_requirements)
        ? candidate.missing_requirements
        : []
  const allExtractedSkills = Array.isArray(candidate?.allExtractedSkills)
    ? candidate.allExtractedSkills
    : Array.isArray(candidate?.all_extracted_skills)
      ? candidate.all_extracted_skills
      : []
  const matchedSkills = Array.isArray(candidate?.matchedSkills)
    ? candidate.matchedSkills
    : Array.isArray(candidate?.matched_skills)
      ? candidate.matched_skills
      : matchedRequirements
  const risksOrGaps = String(fitAssessment.risks_or_gaps || '').trim()
  const rationale = String(fitAssessment.rationale || '').trim()

  const rawScore = Number(candidate?.matchScore?.score ?? candidate?.matchScore ?? candidate?.score ?? candidate?.profile_score ?? 0)
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0
  const reason = String(
    candidate?.matchScore?.reason
    || rationale
    || candidate?.fit_assessment?.reason
    || candidate?.summary
    || 'Reasoning unavailable for this legacy analysis; score is derived from available profile signals.',
  ).trim()
  const strengths = Array.isArray(candidate?.strengths) && candidate.strengths.length > 0
    ? candidate.strengths
    : [reason]
  const considerations = Array.isArray(candidate?.considerations) && candidate.considerations.length > 0
    ? candidate.considerations
    : [risksOrGaps || candidate?.fit_assessment?.risk || 'Review role-specific fit in interview.']

  return {
    ...candidate,
    allExtractedSkills,
    all_extracted_skills: allExtractedSkills,
    matchedSkills,
    matched_skills: matchedSkills,
    missingRequirements,
    missing_requirements: missingRequirements,
    score,
    matchScore: {
      score,
      reason,
    },
    summary: String(candidate?.summary || 'Summary not available for this analysis.').trim(),
    strengths,
    considerations,
    top_skills: Array.isArray(candidate?.top_skills) ? candidate.top_skills : [],
    fit_assessment: {
      ...fitAssessment,
      matched_requirements: matchedRequirements,
      missing_requirements: missingRequirements,
      risks_or_gaps: risksOrGaps,
      rationale,
      matched: Array.isArray(fitAssessment.matched) ? fitAssessment.matched : matchedRequirements,
      missing: Array.isArray(fitAssessment.missing) ? fitAssessment.missing : missingRequirements,
      risk: String(fitAssessment.risk || risksOrGaps).trim(),
      uncertainty: String(fitAssessment.uncertainty || risksOrGaps).trim(),
      reason,
    },
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
