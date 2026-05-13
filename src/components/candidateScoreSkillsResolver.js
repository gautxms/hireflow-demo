import { toDisplayText } from './candidateResultsState.js'

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => toDisplayText(entry, '').trim())
    .filter(Boolean)
}

function dedupe(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = item.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function resolveScoreBreakdown(candidate = {}) {
  const breakdown = candidate?.score_breakdown && typeof candidate.score_breakdown === 'object'
    ? candidate.score_breakdown
    : candidate?.scoreBreakdown && typeof candidate.scoreBreakdown === 'object'
      ? candidate.scoreBreakdown
      : null

  if (!breakdown) {
    return { isValid: false, items: [] }
  }

  const allowedFields = [
    ['Skills alignment', breakdown.skills_alignment],
    ['Experience alignment', breakdown.experience_alignment],
    ['Education alignment', breakdown.education_alignment],
    ['Overall score', breakdown.overall],
  ]

  const items = allowedFields
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([label, value]) => ({ label, value }))

  return { isValid: items.length > 0, items }
}

export function resolveSkillSignals(candidate = {}) {
  const explicitMatched = dedupe(normalizeList(candidate?.matchedSkills || candidate?.matched_skills || candidate?.fit_assessment?.matched))
  const relevantSkills = dedupe(normalizeList(candidate?.relevantSkills || candidate?.relevant_skills || candidate?.top_skills || candidate?.skills))
  const skillGaps = dedupe(normalizeList(candidate?.missingSkills || candidate?.missing_skills || candidate?.fit_assessment?.missing || candidate?.skill_gaps || candidate?.skillGaps))
  const allSkills = dedupe(normalizeList(candidate?.top_skills || candidate?.skills))

  const hasExplicitMatched = explicitMatched.length > 0
  const label = hasExplicitMatched ? 'MATCHED SKILLS' : 'RELEVANT SKILLS'
  const primarySkills = hasExplicitMatched ? explicitMatched : relevantSkills
  const source = hasExplicitMatched ? 'explicit' : primarySkills.length > 0 ? 'inferred' : 'none'
  const confidence = hasExplicitMatched ? 'high' : primarySkills.length > 0 ? 'medium' : 'low'
  const helperCopy = hasExplicitMatched
    ? 'Directly matched skills from the analysis payload.'
    : 'Inferred relevant skills based on available profile skill lists.'

  return {
    label,
    primarySkills,
    hasExplicitMatched,
    source,
    confidence,
    helperCopy,
    skillGaps,
    allSkills,
  }
}
