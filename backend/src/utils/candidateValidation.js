const FAILURE_PLACEHOLDER_PATTERNS = [
  /parse(?:r|d)?\s*(?:failed|failure)/,
  /extract(?:ion)?\s*(?:failed|failure|unable|could not|did not)/,
  /unable to\s*(?:parse|extract)/,
  /could not\s*(?:parse|extract)/,
  /unreadable/,
  /corrupt(?:ed|ion)?/,
  /compressed\/?encrypted/,
  /binary content/,
  /manual review required/,
  /scoring deferred/,
  /no\s+(?:skills|education|work history)\s+(?:found|extracted|identified|available)/,
]

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function collectFailureCorpus(candidate = {}) {
  const textParts = [
    candidate?.summary,
    candidate?.concerns,
    candidate?.considerations,
    candidate?.resumeWarnings,
    candidate?.uncertaintyNotes,
    candidate?.reasoning,
    candidate?.parseError,
    candidate?.parse_error,
    candidate?.matchScore?.reason,
  ]

  return textParts
    .flatMap((entry) => {
      if (Array.isArray(entry)) return entry
      if (entry && typeof entry === 'object') return Object.values(entry)
      return [entry]
    })
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .join(' ')
}

function hasFailureStructure(candidate = {}) {
  const skillsCount = Array.isArray(candidate?.skills)
    ? candidate.skills.filter(Boolean).length
    : 0
  const educationCount = Array.isArray(candidate?.education)
    ? candidate.education.filter(Boolean).length
    : 0

  const experience = candidate?.experience
  const experienceYears = candidate?.experienceYears ?? candidate?.experience_years
  const hasNullExperience = experience == null && experienceYears == null

  const rawScore = Number(candidate?.score ?? candidate?.matchScore?.score ?? candidate?.profile_score ?? Number.NaN)
  const scoreIsZero = Number.isFinite(rawScore) && rawScore === 0

  const fitStatus = normalizeText(candidate?.fitStatus)
  const isUnscored = fitStatus === 'unscored'
  const isFitStatusMissing = !fitStatus

  return skillsCount === 0
    && educationCount === 0
    && hasNullExperience
    && scoreIsZero
    && (isUnscored || isFitStatusMissing)
}

function hasRealEvidence(candidate = {}) {
  const skillsCount = Array.isArray(candidate?.skills)
    ? candidate.skills.filter(Boolean).length
    : 0
  const educationCount = Array.isArray(candidate?.education)
    ? candidate.education.filter(Boolean).length
    : 0

  const hasExperience = candidate?.experience != null
    || candidate?.experienceYears != null
    || candidate?.experience_years != null

  const rawScore = Number(candidate?.score ?? candidate?.matchScore?.score ?? candidate?.profile_score ?? Number.NaN)
  const hasScoredValue = Number.isFinite(rawScore) && rawScore > 0

  const fitStatus = normalizeText(candidate?.fitStatus)
  const hasScoredFit = fitStatus && fitStatus !== 'unscored'

  return skillsCount > 0 || educationCount > 0 || hasExperience || hasScoredValue || hasScoredFit
}

export function isFailurePlaceholderCandidate(candidate = {}) {
  const corpus = collectFailureCorpus(candidate)
  const hasFailureText = FAILURE_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(corpus))
  const hasFailureSignals = hasFailureText && hasFailureStructure(candidate)

  if (hasFailureSignals && hasRealEvidence(candidate)) {
    return false
  }

  return hasFailureSignals
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

export function isFailureNarrativeCandidate(candidate = {}) {
  const missingFieldsPattern = String.raw`no\s+(?:work\s+history|skills|education|achievements)(?:\s*(?:,|and|or)\s*(?:work\s+history|skills|education|achievements))*\s+(?:are\s+)?(?:readable|extractable|available|found)`
  const failurePhrasePattern = new RegExp(
    `(?:parsing failed|parser failed|unreadable|corrupted|content is not extractable|unable to assess|cannot be reliably extracted|pdf parsing failed|${missingFieldsPattern})`,
    'i',
  )
  const failureNarratives = [
    candidate?.summary,
    candidate?.reasoning,
    candidate?.matchScore?.reason,
    candidate?.concerns,
    candidate?.warnings,
    candidate?.resumeWarnings,
    candidate?.uncertaintyNotes,
  ]
    .flat()
    .map((value) => String(value || ''))

  if (!failureNarratives.some((value) => failurePhrasePattern.test(value))) return false

  const hasSkills = Array.isArray(candidate?.skills_flat) ? candidate.skills_flat.filter(Boolean).length > 0 : false
  const hasEducation = Array.isArray(candidate?.education) ? candidate.education.filter(Boolean).length > 0 : false
  const hasExperienceEvidence = Array.isArray(candidate?.experienceEvidence) ? candidate.experienceEvidence.filter(Boolean).length > 0 : false
  const hasExperienceEntries = Array.isArray(candidate?.experience) ? candidate.experience.filter(Boolean).length > 0 : candidate?.experience != null
  const hasExperienceValue = candidate?.years_experience != null
    || candidate?.experience_years != null
    || candidate?.experienceYears != null
    || candidate?.totalExperienceYears != null
    || candidate?.relevantExperienceYears != null

  return !hasSkills && !hasEducation && !hasExperienceEvidence && !hasExperienceEntries && !hasExperienceValue
}

export function isCandidateScoringValid(candidate = {}) {
  const rawScore = resolveRawScore(candidate)
  const reasoning = resolveReasoning(candidate)
  return Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 100 && Boolean(reasoning)
}

export function getCandidateValidationFailureReasons(candidate = {}) {
  const reasons = []

  if (!candidate || typeof candidate !== 'object') {
    return ['candidate_not_object']
  }

  if (isFailurePlaceholderCandidate(candidate)) reasons.push('failure_placeholder_detected')
  if (isFailureNarrativeCandidate(candidate)) reasons.push('failure_narrative_detected')

  const rawScore = resolveRawScore(candidate)
  if (!Number.isFinite(rawScore)) {
    reasons.push('score_not_finite')
  } else if (rawScore < 0 || rawScore > 100) {
    reasons.push('score_out_of_range')
  }

  const reasoning = resolveReasoning(candidate)
  if (!reasoning) reasons.push('missing_required_reasoning')

  const matchScore = candidate?.matchScore
  if (matchScore != null && typeof matchScore !== 'object') reasons.push('match_score_malformed')

  if (candidate?.skills != null && !Array.isArray(candidate.skills)) reasons.push('skills_malformed_array')
  if (candidate?.skills_flat != null && !Array.isArray(candidate.skills_flat)) reasons.push('skills_flat_malformed_array')
  if (candidate?.education != null && !Array.isArray(candidate.education)) reasons.push('education_malformed_array')
  if (candidate?.experienceEvidence != null && !Array.isArray(candidate.experienceEvidence)) reasons.push('experience_evidence_malformed_array')

  const fitStatus = candidate?.fitStatus
  if (fitStatus != null) {
    const normalizedFit = normalizeText(fitStatus)
    if (!['strong_fit', 'good_fit', 'potential_fit', 'not_a_fit', 'unscored'].includes(normalizedFit)) {
      reasons.push('fit_status_enum_mismatch')
    }
  }

  return reasons
}

export function isCandidateValidForScoredOutcome(candidate = {}) {
  return getCandidateValidationFailureReasons(candidate).length === 0
}
