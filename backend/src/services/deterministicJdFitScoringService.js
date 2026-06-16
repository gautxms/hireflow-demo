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
const normalizeEvidenceText = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9.+#\s-]/g, ' ')
  .replace(/\b(?:with|and|or|the|a|an|for|to|of|in|on|at|required|requirement|requirements|experience|experienced|skills?|evidence|candidate|has|have|having)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const canonicalEvidenceText = (value) => normalizeEvidenceText(value)
  .split(' ')
  .filter(Boolean)
  .sort()
  .join(' ')

const uniqueNormalized = (values) => [...new Set(asArray(values).map(canonicalEvidenceText).filter(Boolean))]

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
  const matched = uniqueNormalized(fitAssessment?.matched_requirements).length
  const missing = uniqueNormalized(fitAssessment?.missing_requirements).length
  const total = matched + missing
  const score = total > 0 ? smoothEvidenceRatioScore(matched, missing) : 35
  return { score: roundScore(score), weight: WEIGHTS.requirement_match, matched_count: matched, missing_count: missing, total_count: total }
}

const smoothEvidenceRatioScore = (matched, missing) => {
  const total = matched + missing
  if (total <= 0) return 35

  const rawScore = (matched / total) * 100
  const dampenedScore = 50 + ((rawScore - 50) * Math.min(1, total / 8))

  if (matched >= 2 && missing >= 2) return clamp(dampenedScore, 40, 60)
  return dampenedScore
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
  if (totalCompared > 0) score = smoothEvidenceRatioScore(matched, missing)
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


const flattenText = (value) => {
  if (!present(value)) return []
  if (Array.isArray(value)) return value.flatMap(flattenText)
  if (isObject(value)) return Object.values(value).flatMap(flattenText)
  return [String(value)]
}

const candidateExperienceEvidenceTexts = (candidate, fitAssessment) => [
  ...flattenText(candidate?.summary),
  ...flattenText(candidate?.recommendation),
  ...flattenText(candidate?.matchScore?.reason),
  ...flattenText(candidate?.matchScore?.breakdown),
  ...flattenText(fitAssessment?.rationale),
  ...flattenText(fitAssessment?.notes),
  ...flattenText(fitAssessment?.risks_or_gaps),
  ...flattenText(candidate?.missingSkills),
  ...flattenText(fitAssessment?.missing_requirements),
  ...flattenText(candidate?.concerns),
  ...flattenText(candidate?.considerations),
  ...flattenText(fitAssessment?.concerns),
  ...flattenText(fitAssessment?.considerations),
]

const BELOW_MIN_EXPERIENCE_PATTERNS = Object.freeze([
  /\bbelow\s+(?:the\s+)?(?:minimum|required|target)\b/i,
  /\b(?:experience|years?)\s+gap\b/i,
  /\bjunior\s+profile\b/i,
  /\bearly\s+career\b/i,
  /\bbelow\s+\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*\d+(?:\.\d+)?\s*years?\b/i,
  /\bbelow\s+required\s+years?\b/i,
  /\bless\s+than\s+(?:the\s+)?(?:minimum|required|target)\b/i,
])

const TOTAL_EXPERIENCE_CONTEXT_PATTERN = /\b(?:total|overall|professional|relevant|engineering|software|work)\s+(?:\w+\s+){0,3}experience\b|\bexperience\s*(?::|-)?\s*\d+(?:\.\d+)?\s*(?:years?|yrs?)\b/i
const BELOW_MINIMUM_CONTEXT_PATTERN = /\b(?:below|minimum|required|target|gap|junior|early\s+career)\b/i
const SKILL_DURATION_CONTEXT_PATTERN = /\b(?:including|with|in|using|on|for|of)\s+[a-z0-9.+#-]+\b/i

const reliableTotalExperienceYearsFromText = (text) => {
  const source = String(text ?? '')
  const matches = [...source.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?)\b/gi)]
  const values = []

  for (const match of matches) {
    const value = Number(match[1])
    if (!Number.isFinite(value)) continue

    const index = match.index ?? 0
    const before = source.slice(Math.max(0, index - 45), index)
    const after = source.slice(index + match[0].length, Math.min(source.length, index + match[0].length + 45))
    const near = `${before} ${match[0]} ${after}`
    const afterNumber = source.slice(index + match[0].length, Math.min(source.length, index + match[0].length + 24))
    const beforeNumber = source.slice(Math.max(0, index - 24), index)
    const skillSpecific = SKILL_DURATION_CONTEXT_PATTERN.test(`${beforeNumber} ${afterNumber}`) && !/\bexperience\b/i.test(afterNumber)
    const totalExperience = TOTAL_EXPERIENCE_CONTEXT_PATTERN.test(near) || /\bhas\s*$/i.test(beforeNumber) || /^\s*(?:of\s+)?(?:total\s+|professional\s+|relevant\s+)?experience\b/i.test(afterNumber)
    const belowMinimumContext = BELOW_MINIMUM_CONTEXT_PATTERN.test(near)

    if (!skillSpecific && (totalExperience || belowMinimumContext)) values.push(value)
  }

  return values.length > 0 ? Math.min(...values) : null
}

const belowMinimumExperienceEvidence = (candidate, fitAssessment, requiredMin) => {
  if (requiredMin === null || requiredMin < 2) return { applies: false, safer_years: null, signal_count: 0 }

  let saferYears = null
  let signalCount = 0
  for (const text of candidateExperienceEvidenceTexts(candidate, fitAssessment)) {
    const explicitYears = reliableTotalExperienceYearsFromText(text)
    const normalized = String(text ?? '')
    const hasBelowSignal = BELOW_MIN_EXPERIENCE_PATTERNS.some((pattern) => pattern.test(normalized))
    const hasBelowRequiredRange = new RegExp(`\\bbelow\\s+${requiredMin}(?:\\.0+)?\\s*(?:-|to|–|—)\\s*\\d+(?:\\.\\d+)?\\s*years?\\b`, 'i').test(normalized)
    const explicitBelowMin = explicitYears !== null && explicitYears < requiredMin && /\b(?:years?|yrs?|experience)\b/i.test(normalized)
    if (hasBelowSignal || hasBelowRequiredRange || explicitBelowMin) {
      signalCount += 1
      if (explicitYears !== null) saferYears = saferYears === null ? explicitYears : Math.min(saferYears, explicitYears)
    }
  }

  return { applies: signalCount > 0, safer_years: saferYears, signal_count: signalCount }
}

const ROLE_GAP_PATTERNS = Object.freeze([
  /\bnot\s+sde\b/i,
  /\bqa\b|quality assurance/i,
  /production feature/i,
  /production software development/i,
  /backend ownership/i,
  /service ownership/i,
  /system design/i,
  /architecture/i,
  /\bcloud\b/i,
  /deployment/i,
  /data structures/i,
  /algorithms/i,
])

const roleGapSignalCount = (fitAssessment) => {
  const signals = [
    ...asArray(fitAssessment?.missing_requirements),
    ...asArray(fitAssessment?.risks_or_gaps),
  ]
  return signals.reduce((count, signal) => {
    const text = String(signal ?? '')
    return count + (ROLE_GAP_PATTERNS.some((pattern) => pattern.test(text)) ? 1 : 0)
  }, 0)
}

const experienceRelevanceCap = ({ requirement, skill, roleGapCount }) => {
  const weakRequirementEvidence = requirement.missing_count >= requirement.matched_count && requirement.missing_count >= 2
  const weakSkillEvidence = skill.missing_count >= skill.matched_count && skill.missing_count >= 2
  const weakScoreEvidence = requirement.score < 55 || skill.score < 55

  if (roleGapCount >= 4 && (weakRequirementEvidence || weakSkillEvidence || weakScoreEvidence)) return 55
  if (roleGapCount >= 2 && (weakRequirementEvidence || weakSkillEvidence) && weakScoreEvidence) return 65
  if (roleGapCount >= 1 && requirement.score < 40 && skill.score < 40) return 75
  return null
}

const experienceBreakdown = (candidate, context, fitAssessment, requirement, skill) => {
  const candidateYears = firstNumber(candidate?.years_experience, candidate?.yearsExperience)
  const required = requiredYears(context)
  const roleGapCount = roleGapSignalCount(fitAssessment)
  const belowMinEvidence = belowMinimumExperienceEvidence(candidate, fitAssessment, required.min)
  const saferCandidateYears = belowMinEvidence.safer_years !== null && candidateYears !== null
    ? Math.min(candidateYears, belowMinEvidence.safer_years)
    : (belowMinEvidence.safer_years ?? candidateYears)
  let score = 55
  let cap = null
  if (saferCandidateYears === null) score = belowMinEvidence.applies ? 55 : 35
  else if (required.min === null && required.max === null) score = 60
  else if (required.min !== null && saferCandidateYears < required.min) score = Math.max(20, (saferCandidateYears / Math.max(required.min, 1)) * 70)
  else {
    score = 100
    cap = experienceRelevanceCap({ requirement, skill, roleGapCount })
    if (belowMinEvidence.applies) cap = Math.min(cap ?? 58, 58)
    if (cap !== null) score = Math.min(score, cap)
  }
  return {
    score: roundScore(score),
    weight: WEIGHTS.experience_alignment,
    candidate_years: candidateYears,
    required_min_years: required.min,
    required_max_years: required.max,
    experience_relevance_cap_applied: cap !== null || belowMinEvidence.applies,
    role_gap_signal_count: roleGapCount,
    below_min_experience_evidence_applied: belowMinEvidence.applies,
    below_min_experience_signal_count: belowMinEvidence.signal_count,
    safer_candidate_years: saferCandidateYears,
  }
}

const normalizeLocation = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const normalizeLocationToken = (value) => normalizeLocation(value).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
const hasExplicitRemote = (value) => /\bremote\b/.test(value)
const hasFlexibleLocation = (value) => /\bremote\b|\bhybrid\b/.test(value)
const WORK_MODE_LOCATION_TOKENS = new Set(['remote', 'hybrid', 'remote hybrid', 'onsite', 'on site'])
const tokenizeJdLocations = (value) => normalizeLocation(value)
  .split(/\s*(?:\/|,|;|\||\bor\b|\band\b)\s*/i)
  .map(normalizeLocationToken)
  .filter((token) => token.length > 0 && !WORK_MODE_LOCATION_TOKENS.has(token))
const locationTokenMatches = (candidateLocation, jdLocation) => tokenizeJdLocations(jdLocation)
  .some((token) => candidateLocation === token || candidateLocation.startsWith(`${token},`) || candidateLocation.includes(` ${token} `))
const locationBreakdown = (candidate, context) => {
  const candidateLocation = normalizeLocation(candidate?.location)
  const jdLocation = normalizeLocation(context?.location)
  const candidateAvailable = candidateLocation.length > 0
  const jdAvailable = jdLocation.length > 0
  let score = 50
  if (candidateAvailable && jdAvailable) {
    const candidateRemote = hasExplicitRemote(candidateLocation)
    const jdFlexible = hasFlexibleLocation(jdLocation)
    if (candidateLocation.includes(jdLocation) || jdLocation.includes(candidateLocation) || locationTokenMatches(candidateLocation, jdLocation)) score = 95
    else if (candidateRemote && jdFlexible) score = 80
    else if (jdFlexible) score = 40
    else if (candidateRemote) score = 35
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

  const requirement = requirementBreakdown(fitAssessment)
  const skill = skillBreakdown(safeCandidate)
  const breakdown = {
    requirement_match: requirement,
    skill_alignment: skill,
    experience_alignment: experienceBreakdown(safeCandidate, jobDescriptionContext, fitAssessment, requirement, skill),
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
