import { toDisplayText } from './candidateResultsState'

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
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([label, value]) => ({ label, value: Number(value) }))

  return { isValid: items.length > 0, items }
}

export function resolveSkillSignals(candidate = {}) {
  const explicitMatched = dedupe(normalizeList(candidate?.matchedSkills || candidate?.matched_skills || candidate?.fit_assessment?.matched))
  const relevantSkills = dedupe(normalizeList(candidate?.relevantSkills || candidate?.relevant_skills))
  const skillGaps = dedupe(normalizeList(candidate?.missingSkills || candidate?.missing_skills || candidate?.fit_assessment?.missing || candidate?.skill_gaps || candidate?.skillGaps))
  const allSkills = dedupe(normalizeList(candidate?.top_skills || candidate?.skills))

  const hasExplicitMatched = explicitMatched.length > 0
  const label = hasExplicitMatched ? 'Matched skills' : 'Relevant skills'
  const primarySkills = hasExplicitMatched ? explicitMatched : relevantSkills

  return {
    label,
    primarySkills,
    hasExplicitMatched,
    skillGaps,
    allSkills,
  }
}

