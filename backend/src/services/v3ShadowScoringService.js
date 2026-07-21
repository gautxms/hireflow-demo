import { evaluateExperienceRange } from '../utils/experienceRange.js'
import { evaluateLocationAlignment } from '../utils/locationAlignment.js'
import { buildRequirementSemantics } from '../utils/requirementSemantics.js'

export const V3_SHADOW_SCORING_CONTRACT_VERSION = 'deterministic_jd_fit_v3_shadow_v1'

const EDUCATION_REQUIREMENT = /\b(?:degree|bachelor|master|phd|doctorate|b\.?s\.?|b\.?e\.?|btech|mtech|mba|computer science education|academic qualification)\b/i
const SENIORITY_REQUIREMENT = /\b(?:senior|lead(?:er|ership)?|manager|management|mentor|mentoring|architect|staff|principal|director|head of|team leadership|people management)\b/i
const OUTCOME_ACTION = /\b(?:built|created|delivered|deployed|designed|implemented|improved|increased|reduced|scaled|launched|led|owned|optimized|automated|migrated|grew|saved|generated|shipped)\b/i
const QUANTIFIED_OUTCOME = /(?:\b\d+(?:\.\d+)?\s*(?:%|x|k|m|million|billion|hours?|days?|users?|customers?|requests?|transactions?)\b|₹|\$|€|£)/i
const SAFE_DIAGNOSTIC_CODES = new Set([
  'below_minimum_experience',
  'confirmed_location_mismatch',
  'contract_version_mismatch',
  'core_requirement_gap',
  'core_requirements_unresolved',
  'education_requirement_explicit',
  'material_core_requirement_gaps',
  'missing_job_description_context',
  'scoring_exception',
  'seniority_requirement_explicit',
])
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'any', 'at', 'be', 'by', 'candidate', 'experience', 'experienced', 'for', 'from', 'has',
  'have', 'having', 'in', 'is', 'it', 'knowledge', 'minimum', 'must', 'of', 'on', 'or', 'preferred', 'proficiency',
  'required', 'requirement', 'requirements', 'should', 'skill', 'skills', 'strong', 'the', 'to', 'using', 'with', 'years',
])

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round = (value) => Math.round(Number(value) * 10) / 10
const asArray = (value) => (Array.isArray(value) ? value : [])
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const optionalNumber = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
  return Number.isFinite(Number(value)) ? Number(value) : null
}
const optionalBoolean = (value) => typeof value === 'boolean' ? value : null
const enumValue = (value, allowed, fallback = null) => allowed.includes(value) ? value : fallback

function flattenText(value) {
  if (Array.isArray(value)) return value.flatMap(flattenText)
  if (isObject(value)) return Object.values(value).flatMap(flattenText)
  if (value === null || value === undefined) return []
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  return normalized ? [normalized] : []
}

function normalizeComparable(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bnode\s*\.\s*js\b|\bnodejs\b/g, 'node js')
    .replace(/\bnext\s*\.\s*js\b|\bnextjs\b/g, 'next js')
    .replace(/\bc\s*\+\s*\+\b/g, 'cpp')
    .replace(/\bc\s*#/g, 'csharp')
    .replace(/\.net\b|\bdot\s+net\b/g, 'dotnet')
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function meaningfulTokens(value) {
  return [...new Set(normalizeComparable(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[+.#-]+|[+.#-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token) && !/^\d+(?:\.\d+)?$/.test(token)))]
}

function statementMatchesEvidence(statement, evidenceText) {
  const statementTokens = meaningfulTokens(statement)
  if (statementTokens.length === 0) return false
  const evidenceTokens = new Set(meaningfulTokens(evidenceText))
  const overlap = statementTokens.filter((token) => evidenceTokens.has(token)).length
  return overlap >= Math.min(2, statementTokens.length)
}

function uniqueStatements(values) {
  const seen = new Set()
  return values.filter((value) => {
    const key = normalizeComparable(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function candidatePositiveEvidence(candidate) {
  const fit = isObject(candidate?.fit_assessment) ? candidate.fit_assessment : {}
  return flattenText([
    fit.matched_requirements,
    candidate?.matchedSkills,
    candidate?.skills_flat,
    candidate?.skills_structured,
    candidate?.top_skills,
    candidate?.education,
    candidate?.experience,
    candidate?.experiences,
    candidate?.work_experience,
    candidate?.employment_history,
    candidate?.projects,
    candidate?.achievements,
    candidate?.strengths,
  ]).join(' ')
}

function candidateNegativeEvidence(candidate) {
  const fit = isObject(candidate?.fit_assessment) ? candidate.fit_assessment : {}
  return flattenText([
    fit.missing_requirements,
    candidate?.missingSkills,
    candidate?.missingRequirementsFull,
  ]).join(' ')
}

function coveredAlternative(statement, semantics, positiveEvidence) {
  return asArray(semantics?.alternativeGroups).some((group) => {
    const statementIncludesGroup = asArray(group).some((option) => statementMatchesEvidence(option, statement))
    return statementIncludesGroup && asArray(group).some((option) => statementMatchesEvidence(option, positiveEvidence))
  })
}

function classifyRequirement(statement, { semantics, positiveEvidence, negativeEvidence }) {
  if (coveredAlternative(statement, semantics, positiveEvidence)) return 'matched'
  if (statementMatchesEvidence(statement, positiveEvidence)) return 'matched'
  if (statementMatchesEvidence(statement, negativeEvidence)) return 'missing'
  return 'unknown'
}

function resolveRequiredStatements(candidate, semantics) {
  const fit = isObject(candidate?.fit_assessment) ? candidate.fit_assessment : {}
  const configured = asArray(semantics?.required)
  if (configured.length > 0) return uniqueStatements(configured)
  return uniqueStatements([
    ...asArray(fit.matched_requirements),
    ...asArray(fit.missing_requirements),
    ...asArray(candidate?.matchedSkills),
    ...asArray(candidate?.missingSkills),
  ])
}

function coreRequirementBreakdown(candidate, semantics) {
  const positiveEvidence = candidatePositiveEvidence(candidate)
  const negativeEvidence = candidateNegativeEvidence(candidate)
  const required = resolveRequiredStatements(candidate, semantics)
  const classifications = required.map((statement) => classifyRequirement(statement, {
    semantics,
    positiveEvidence,
    negativeEvidence,
  }))
  const matched = classifications.filter((value) => value === 'matched').length
  const missing = classifications.filter((value) => value === 'missing').length
  const unknown = classifications.filter((value) => value === 'unknown').length
  const total = classifications.length
  const score = total > 0 ? ((matched + (unknown * 0.35)) / total) * 100 : 35

  return {
    score: round(score),
    matched_count: matched,
    missing_count: missing,
    unknown_count: unknown,
    total_count: total,
    education_requirement_explicit: required.some((statement) => EDUCATION_REQUIREMENT.test(statement)),
    seniority_requirement_explicit: required.some((statement) => SENIORITY_REQUIREMENT.test(statement)),
  }
}

function demonstratedOutcomesBreakdown(candidate) {
  const entries = flattenText([
    candidate?.experience,
    candidate?.experiences,
    candidate?.work_experience,
    candidate?.employment_history,
    candidate?.projects,
    candidate?.achievements,
  ])
  const actionCount = entries.filter((entry) => OUTCOME_ACTION.test(entry)).length
  const quantifiedCount = entries.filter((entry) => QUANTIFIED_OUTCOME.test(entry)).length
  const score = entries.length === 0
    ? 20
    : clamp(45 + (Math.min(entries.length, 4) * 8) + (Math.min(actionCount, 3) * 6) + (Math.min(quantifiedCount, 2) * 10), 0, 100)
  return {
    score: round(score),
    evidence_entry_count: Math.min(entries.length, 20),
    action_evidence_count: Math.min(actionCount, 20),
    quantified_outcome_count: Math.min(quantifiedCount, 20),
  }
}

function experienceBreakdown(candidate, context) {
  const range = {
    min: context?.experienceMin ?? context?.required_min_years ?? context?.min_years ?? null,
    max: context?.experienceMax ?? context?.required_max_years ?? context?.max_years ?? null,
  }
  const evaluation = evaluateExperienceRange(candidate?.years_experience ?? candidate?.yearsExperience, range)
  const explicit = evaluation.minimumYears !== null || evaluation.maximumYears !== null
  let score = 50
  if (!explicit) score = 100
  else if (evaluation.classification === 'within_range' || evaluation.classification === 'above_range') score = 100
  else if (evaluation.classification === 'below_range' && evaluation.minimumYears > 0) {
    score = clamp((evaluation.candidateYears / evaluation.minimumYears) * 70, 10, 70)
  }
  return {
    score: round(score),
    applies: explicit,
    classification: evaluation.classification,
    candidate_years: evaluation.candidateYears,
    minimum_years: evaluation.minimumYears,
    maximum_years: evaluation.maximumYears,
  }
}

function preferredBreakdown(candidate, semantics) {
  const preferred = uniqueStatements(asArray(semantics?.preferred))
  const positiveEvidence = candidatePositiveEvidence(candidate)
  const matched = preferred.filter((statement) => statementMatchesEvidence(statement, positiveEvidence)).length
  return {
    matched_count: matched,
    total_count: preferred.length,
    bonus: preferred.length > 0 ? round((matched / preferred.length) * 5) : 0,
  }
}

function evidenceConfidence(core, outcomes) {
  const knownCore = core.total_count > 0 ? (core.matched_count + core.missing_count) / core.total_count : 0
  if (knownCore >= 0.8 && outcomes.evidence_entry_count >= 2) return 'high'
  if (knownCore >= 0.5 || outcomes.evidence_entry_count >= 1) return 'medium'
  return 'low'
}

function scoreBand(score) {
  if (score >= 98) return 'exceptional'
  if (score >= 93) return 'excellent'
  if (score >= 88) return 'strong'
  if (score >= 80) return 'good'
  if (score >= 70) return 'moderate'
  return 'low'
}

export function scoreCandidateWithV3Shadow(candidate = {}, jobDescriptionContext = null) {
  if (!isObject(jobDescriptionContext) || !jobDescriptionContext.hasContext) {
    return {
      scoring_contract_version: V3_SHADOW_SCORING_CONTRACT_VERSION,
      scoring_mode: 'shadow_only',
      status: 'skipped_no_job_description',
      final_score: null,
      score_out_of_ten: null,
      score_band: 'unavailable',
      confidence: 'low',
      components: null,
      adjustments: null,
      diagnostic_codes: ['missing_job_description_context'],
    }
  }

  const semantics = jobDescriptionContext.requirementSemantics || buildRequirementSemantics(jobDescriptionContext)
  const core = coreRequirementBreakdown(candidate, semantics)
  const outcomes = demonstratedOutcomesBreakdown(candidate)
  const experience = experienceBreakdown(candidate, jobDescriptionContext)
  const preferred = preferredBreakdown(candidate, semantics)
  const location = evaluateLocationAlignment(candidate, jobDescriptionContext)
  const weights = experience.applies
    ? { core_requirements: 0.6, demonstrated_outcomes: 0.2, experience_alignment: 0.2 }
    : { core_requirements: 0.7, demonstrated_outcomes: 0.3, experience_alignment: 0 }
  const locationPenalty = location.classification === 'mismatch' ? 8 : 0
  const rawScore = (core.score * weights.core_requirements)
    + (outcomes.score * weights.demonstrated_outcomes)
    + (experience.score * weights.experience_alignment)
    + preferred.bonus
    - locationPenalty
  const missingRatio = core.total_count > 0 ? core.missing_count / core.total_count : 1
  let cap = null
  const diagnosticCodes = []
  if (core.total_count === 0) {
    cap = 69
    diagnosticCodes.push('core_requirements_unresolved')
  } else if (missingRatio >= 0.5) {
    cap = 69
    diagnosticCodes.push('material_core_requirement_gaps')
  } else if (core.missing_count > 0) {
    cap = 94
    diagnosticCodes.push('core_requirement_gap')
  }
  if (experience.classification === 'below_range') {
    cap = Math.min(cap ?? 89, experience.score < 50 ? 79 : 89)
    diagnosticCodes.push('below_minimum_experience')
  }
  if (locationPenalty > 0) diagnosticCodes.push('confirmed_location_mismatch')
  if (core.education_requirement_explicit) diagnosticCodes.push('education_requirement_explicit')
  if (core.seniority_requirement_explicit) diagnosticCodes.push('seniority_requirement_explicit')

  const uncappedScore = clamp(rawScore, 0, 100)
  const finalScore = round(cap === null ? uncappedScore : Math.min(uncappedScore, cap))
  return {
    scoring_contract_version: V3_SHADOW_SCORING_CONTRACT_VERSION,
    scoring_mode: 'shadow_only',
    status: 'computed',
    final_score: finalScore,
    score_out_of_ten: round(finalScore / 10),
    score_band: scoreBand(finalScore),
    confidence: evidenceConfidence(core, outcomes),
    components: {
      core_requirements: { ...core, weight: weights.core_requirements },
      demonstrated_outcomes: { ...outcomes, weight: weights.demonstrated_outcomes },
      experience_alignment: { ...experience, weight: weights.experience_alignment },
      preferred_qualifications: preferred,
      location_alignment: {
        classification: location.classification,
        score: location.score,
        confirmed_mismatch_penalty: locationPenalty,
      },
    },
    adjustments: {
      preferred_bonus: preferred.bonus,
      confirmed_location_penalty: locationPenalty,
      score_cap: cap,
    },
    diagnostic_codes: [...new Set(diagnosticCodes)].sort(),
  }
}

export function normalizeV3ShadowContract(value) {
  if (!isObject(value) || value.scoring_contract_version !== V3_SHADOW_SCORING_CONTRACT_VERSION) return null
  const components = isObject(value.components) ? value.components : {}
  const core = isObject(components.core_requirements) ? components.core_requirements : {}
  const outcomes = isObject(components.demonstrated_outcomes) ? components.demonstrated_outcomes : {}
  const experience = isObject(components.experience_alignment) ? components.experience_alignment : {}
  const preferred = isObject(components.preferred_qualifications) ? components.preferred_qualifications : {}
  const location = isObject(components.location_alignment) ? components.location_alignment : {}
  const adjustments = isObject(value.adjustments) ? value.adjustments : {}
  const status = enumValue(value.status, ['computed', 'failed_open', 'skipped_no_job_description'], 'failed_open')

  return {
    scoring_contract_version: V3_SHADOW_SCORING_CONTRACT_VERSION,
    scoring_mode: 'shadow_only',
    status,
    final_score: optionalNumber(value.final_score),
    score_out_of_ten: optionalNumber(value.score_out_of_ten),
    score_band: enumValue(value.score_band, ['exceptional', 'excellent', 'strong', 'good', 'moderate', 'low', 'unavailable'], 'unavailable'),
    confidence: enumValue(value.confidence, ['high', 'medium', 'low'], 'low'),
    components: value.components === null ? null : {
      core_requirements: {
        score: optionalNumber(core.score),
        weight: optionalNumber(core.weight),
        matched_count: optionalNumber(core.matched_count),
        missing_count: optionalNumber(core.missing_count),
        unknown_count: optionalNumber(core.unknown_count),
        total_count: optionalNumber(core.total_count),
        education_requirement_explicit: optionalBoolean(core.education_requirement_explicit),
        seniority_requirement_explicit: optionalBoolean(core.seniority_requirement_explicit),
      },
      demonstrated_outcomes: {
        score: optionalNumber(outcomes.score),
        weight: optionalNumber(outcomes.weight),
        evidence_entry_count: optionalNumber(outcomes.evidence_entry_count),
        action_evidence_count: optionalNumber(outcomes.action_evidence_count),
        quantified_outcome_count: optionalNumber(outcomes.quantified_outcome_count),
      },
      experience_alignment: {
        score: optionalNumber(experience.score),
        weight: optionalNumber(experience.weight),
        applies: optionalBoolean(experience.applies),
        classification: enumValue(experience.classification, ['below_range', 'within_range', 'above_range', 'unknown']),
        candidate_years: optionalNumber(experience.candidate_years),
        minimum_years: optionalNumber(experience.minimum_years),
        maximum_years: optionalNumber(experience.maximum_years),
      },
      preferred_qualifications: {
        matched_count: optionalNumber(preferred.matched_count),
        total_count: optionalNumber(preferred.total_count),
        bonus: optionalNumber(preferred.bonus),
      },
      location_alignment: {
        classification: enumValue(location.classification, ['match', 'compatible', 'mismatch', 'unknown']),
        score: optionalNumber(location.score),
        confirmed_mismatch_penalty: optionalNumber(location.confirmed_mismatch_penalty),
      },
    },
    adjustments: value.adjustments === null ? null : {
      preferred_bonus: optionalNumber(adjustments.preferred_bonus),
      confirmed_location_penalty: optionalNumber(adjustments.confirmed_location_penalty),
      score_cap: optionalNumber(adjustments.score_cap),
    },
    diagnostic_codes: asArray(value.diagnostic_codes)
      .map((code) => String(code))
      .filter((code) => SAFE_DIAGNOSTIC_CODES.has(code))
      .slice(0, 12),
  }
}

export const __testables = {
  meaningfulTokens,
  statementMatchesEvidence,
  coreRequirementBreakdown,
  demonstratedOutcomesBreakdown,
  experienceBreakdown,
  preferredBreakdown,
  SAFE_DIAGNOSTIC_CODES,
}
