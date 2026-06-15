const CONTRACT_VERSION = 'deterministic_jd_fit_v1'

const WEIGHTS = Object.freeze({
  requirement_match: 0.4,
  skill_alignment: 0.25,
  experience_alignment: 0.15,
  location_alignment: 0.05,
  evidence_completeness: 0.1,
  profile_prior: 0.05,
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const roundScore = (value) => Math.round(clamp(value, 0, 100) * 10) / 10
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])
const present = (value) => value !== null && value !== undefined && String(value).trim() !== ''
const uniqueNormalized = (values) => [...new Set(asArray(values).map((value) => String(value).trim().toLowerCase()).filter(Boolean))]

const numericValue = (value) => {
  if (!present(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const firstNumber = (...values) => {
  for (const value of values) {
    const number = numericValue(value)
    if (number !== null) return number
  }
  return null
}

const meaningfulJdValue = (value) => {
  if (Array.isArray(value)) return value.some(meaningfulJdValue)
  if (isObject(value)) return Object.values(value).some(meaningfulJdValue)
  if (typeof value === 'boolean') return false
  return present(value)
}

const hasJdContext = (context) => {
  if (!isObject(context)) return false
  if (context.hasContext === false) return false
  if (context.hasContext === true) return true

  return [
    context.title,
    context.jobTitle,
    context.description,
    context.jobDescription,
    context.requirements,
    context.required_requirements,
    context.skills,
    context.required_skills,
    context.location,
    context.fileText,
    context.required_min_years,
    context.required_max_years,
    context.min_years,
    context.max_years,
    context.minYears,
    context.maxYears,
    context.years_experience_min,
    context.years_experience_max,
    context.experienceMin,
    context.experienceMax,
    context.experienceYears,
    context.experience,
  ].some(meaningfulJdValue)
}

const requirementBreakdown = (fitAssessment) => {
  const matched = asArray(fitAssessment?.matched_requirements).length
  const missing = asArray(fitAssessment?.missing_requirements).length
  const total = matched + missing
  const score = total > 0 ? (matched / total) * 100 : 35
  return { score: roundScore(score), weight: WEIGHTS.requirement_match, matched_count: matched, missing_count: missing, total_count: total }
}

const skillBreakdown = (candidate) => {
  const matched = uniqueNormalized(candidate?.matchedSkills).length
  const missing = uniqueNormalized(candidate?.missingSkills).length
  const candidateSkillCount = uniqueNormalized([
    ...asArray(candidate?.skills_flat),
    ...asArray(candidate?.top_skills),
  ]).length
  const totalCompared = matched + missing
  let score = 35
  if (totalCompared > 0) score = (matched / totalCompared) * 100
  else if (candidateSkillCount > 0) score = 55
  return {
    score: roundScore(score),
    weight: WEIGHTS.skill_alignment,
    matched_count: matched,
    missing_count: missing,
    candidate_skill_count: candidateSkillCount,
  }
}

const requiredYears = (context) => {
  const experienceYears = context?.experienceYears
  const experienceYearsMin = isObject(experienceYears) ? experienceYears.min : experienceYears
  const experienceYearsMax = isObject(experienceYears) ? experienceYears.max : null
  const min = firstNumber(
    context?.required_min_years,
    context?.min_years,
    context?.minYears,
    context?.years_experience_min,
    context?.experienceMin,
    experienceYearsMin,
    context?.experience?.min,
    context?.experience?.minimum,
  )
  const max = firstNumber(
    context?.required_max_years,
    context?.max_years,
    context?.maxYears,
    context?.years_experience_max,
    context?.experienceMax,
    experienceYearsMax,
    context?.experience?.max,
    context?.experience?.maximum,
  )
  return { min, max }
}

const experienceBreakdown = (candidate, context) => {
  const candidateYears = firstNumber(candidate?.years_experience, candidate?.yearsExperience)
  const required = requiredYears(context)
  let score = 55
  if (candidateYears === null) score = 35
  else if (required.min === null && required.max === null) score = 60
  else if (required.min !== null && candidateYears < required.min) score = Math.max(20, (candidateYears / Math.max(required.min, 1)) * 70)
  else score = 100
  return {
    score: roundScore(score),
    weight: WEIGHTS.experience_alignment,
    candidate_years: candidateYears,
    required_min_years: required.min,
    required_max_years: required.max,
  }
}

const normalizeLocation = (value) => String(value ?? '').trim().toLowerCase()
const locationBreakdown = (candidate, context) => {
  const candidateLocation = normalizeLocation(candidate?.location)
  const jdLocation = normalizeLocation(context?.location)
  const candidateAvailable = candidateLocation.length > 0
  const jdAvailable = jdLocation.length > 0
  let score = 50
  if (candidateAvailable && jdAvailable) {
    const candidateRemote = /remote|hybrid/.test(candidateLocation)
    const jdRemote = /remote|hybrid/.test(jdLocation)
    if (candidateLocation.includes(jdLocation) || jdLocation.includes(candidateLocation)) score = 95
    else if (candidateRemote || jdRemote) score = 65
    else score = 25
  }
  return { score, weight: WEIGHTS.location_alignment, candidate_location_available: candidateAvailable, jd_location_available: jdAvailable }
}

const evidenceBreakdown = (candidate, context, fitAssessment) => {
  const signals = [
    asArray(fitAssessment?.matched_requirements).length || asArray(fitAssessment?.missing_requirements).length,
    uniqueNormalized([...asArray(candidate?.matchedSkills), ...asArray(candidate?.missingSkills), ...asArray(candidate?.skills_flat), ...asArray(candidate?.top_skills)]).length,
    firstNumber(candidate?.years_experience, candidate?.yearsExperience) !== null,
    present(candidate?.location) && present(context?.location),
    isObject(candidate?.confidence),
  ].filter(Boolean).length
  return { score: roundScore((signals / 5) * 100), weight: WEIGHTS.evidence_completeness, available_signal_count: signals }
}

const profilePriorBreakdown = (candidate) => {
  const profileScore = numericValue(candidate?.profile_score)
  return { score: profileScore === null ? 50 : roundScore(profileScore), weight: WEIGHTS.profile_prior, used: profileScore !== null }
}

const confidenceBreakdown = (candidate) => {
  const confidence = isObject(candidate?.confidence) ? candidate.confidence : {}
  const values = [confidence.skills, confidence.experience, confidence.fit_assessment].map(numericValue).filter((value) => value !== null)
  if (values.length === 0) return { multiplier: 0.95, available_confidence_fields: 0 }
  const normalized = values.map((value) => (value > 1 ? value / 100 : value))
  const average = normalized.reduce((sum, value) => sum + value, 0) / normalized.length
  return { multiplier: roundScore(90 + clamp(average, 0, 1) * 10) / 100, available_confidence_fields: values.length }
}

const riskBreakdown = (fitAssessment) => {
  const gapCount = asArray(fitAssessment?.risks_or_gaps).length
  return { penalty: Math.min(10, gapCount * 2), gap_count: gapCount }
}

const bandAndVerdict = (score) => {
  if (score === null) return { score_band: 'insufficient_evidence', verdict: 'Insufficient evidence' }
  if (score >= 85) return { score_band: 'excellent', verdict: 'Highly aligned' }
  if (score >= 70) return { score_band: 'strong', verdict: 'Aligned' }
  if (score >= 50) return { score_band: 'moderate', verdict: 'Potential fit' }
  return { score_band: 'weak', verdict: 'Low fit' }
}

const emptyBreakdown = () => ({
  requirement_match: { score: 0, weight: WEIGHTS.requirement_match, matched_count: 0, missing_count: 0, total_count: 0 },
  skill_alignment: { score: 0, weight: WEIGHTS.skill_alignment, matched_count: 0, missing_count: 0, candidate_skill_count: 0 },
  experience_alignment: { score: 0, weight: WEIGHTS.experience_alignment, candidate_years: null, required_min_years: null, required_max_years: null },
  location_alignment: { score: 0, weight: WEIGHTS.location_alignment, candidate_location_available: false, jd_location_available: false },
  evidence_completeness: { score: 0, weight: WEIGHTS.evidence_completeness, available_signal_count: 0 },
  profile_prior: { score: 0, weight: WEIGHTS.profile_prior, used: false },
  risk_penalty: { penalty: 0, gap_count: 0 },
  confidence_adjustment: { multiplier: 0.95, available_confidence_fields: 0 },
})

export function scoreCandidateDeterministically(candidate = {}, jobDescriptionContext = null, options = {}) {
  void options
  const safeCandidate = isObject(candidate) ? candidate : {}
  const fitAssessment = isObject(safeCandidate.fit_assessment) ? safeCandidate.fit_assessment : {}
  const jdAvailable = hasJdContext(jobDescriptionContext)

  if (!jdAvailable) {
    const profile = profilePriorBreakdown(safeCandidate)
    const hasProfileOnly = profile.used
    const finalScore = hasProfileOnly ? roundScore(profile.score) : null
    const mapping = bandAndVerdict(finalScore)
    return {
      final_score: finalScore,
      score_out_of_ten: finalScore === null ? null : Math.round(finalScore) / 10,
      ...mapping,
      scoring_mode: hasProfileOnly ? 'profile_only' : 'insufficient_evidence',
      scoring_contract_version: CONTRACT_VERSION,
      scoring_breakdown: { ...emptyBreakdown(), profile_prior: profile },
      scoring_explanation: hasProfileOnly
        ? 'Profile-only deterministic fallback used because no job description context was available.'
        : 'Insufficient structured evidence to compute a deterministic JD-fit score.',
    }
  }

  const breakdown = {
    requirement_match: requirementBreakdown(fitAssessment),
    skill_alignment: skillBreakdown(safeCandidate),
    experience_alignment: experienceBreakdown(safeCandidate, jobDescriptionContext),
    location_alignment: locationBreakdown(safeCandidate, jobDescriptionContext),
    evidence_completeness: evidenceBreakdown(safeCandidate, jobDescriptionContext, fitAssessment),
    profile_prior: profilePriorBreakdown(safeCandidate),
    risk_penalty: riskBreakdown(fitAssessment),
    confidence_adjustment: confidenceBreakdown(safeCandidate),
  }

  const weighted = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + breakdown[key].score * weight, 0)
  const finalScore = roundScore((weighted - breakdown.risk_penalty.penalty) * breakdown.confidence_adjustment.multiplier)
  const mapping = bandAndVerdict(finalScore)

  return {
    final_score: finalScore,
    score_out_of_ten: Math.round(finalScore) / 10,
    ...mapping,
    scoring_mode: 'jd_fit',
    scoring_contract_version: CONTRACT_VERSION,
    scoring_breakdown: breakdown,
    scoring_explanation: 'Deterministic JD-fit score computed from structured requirement, skill, experience, location, evidence, risk, and confidence signals.',
  }
}
