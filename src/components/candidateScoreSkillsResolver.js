import { toDisplayText } from './candidateResultsState.js'

export const SCORE_BREAKDOWN_UNAVAILABLE_MESSAGE = 'Detailed score breakdown unavailable for this analysis.'

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

function firstNonEmptyArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value
    }
  }
  return []
}

function normalizeCsvString(value) {
  if (typeof value !== 'string') {
    return []
  }

  return value
    .split(',')
    .map((entry) => toDisplayText(entry, '').trim())
    .filter(Boolean)
}

function flattenStructuredSkills(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }

  const flattened = []

  Object.values(value).forEach((entry) => {
    if (Array.isArray(entry)) {
      flattened.push(...normalizeList(entry))
      return
    }

    if (entry && typeof entry === 'object') {
      Object.values(entry).forEach((nested) => {
        if (Array.isArray(nested)) {
          flattened.push(...normalizeList(nested))
          return
        }

        const text = toDisplayText(nested, '').trim()
        if (text) {
          flattened.push(text)
        }
      })
      return
    }

    const text = toDisplayText(entry, '').trim()
    if (text) {
      flattened.push(text)
    }
  })

  return flattened
}

function firstNonEmptyNormalizedList(...values) {
  for (const value of values) {
    const normalized = normalizeList(value)
    if (normalized.length > 0) {
      return normalized
    }
  }

  return []
}

export function resolveCandidateScoreBreakdown(candidate = {}) {
  const matchScoreBreakdown = candidate?.matchScore?.breakdown
  const breakdown = candidate?.score_breakdown && typeof candidate.score_breakdown === 'object'
    ? candidate.score_breakdown
    : matchScoreBreakdown && typeof matchScoreBreakdown === 'object'
      ? matchScoreBreakdown
    : candidate?.scoreBreakdown && typeof candidate.scoreBreakdown === 'object'
      ? candidate.scoreBreakdown
      : null

  if (!breakdown) {
    return { isValid: false, items: [] }
  }

  const isValidScore = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100

  const skillsAlignment = breakdown.skills_alignment
  const experienceAlignment = breakdown.experience_alignment
  const educationAlignment = breakdown.education_alignment
  const overall = breakdown.overall

  if (![skillsAlignment, experienceAlignment, educationAlignment, overall].every(isValidScore)) {
    return { isValid: false, items: [] }
  }

  const subtotal = skillsAlignment + experienceAlignment + educationAlignment
  const expectedOverall = subtotal / 3
  if (Math.abs(expectedOverall - overall) > 1) {
    return { isValid: false, items: [] }
  }

  const allowedFields = [
    ['Skills alignment', skillsAlignment],
    ['Experience alignment', experienceAlignment],
    ['Education alignment', educationAlignment],
    ['Overall score', overall],
  ]

  const items = allowedFields
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([label, value]) => ({ label, value }))

  return { isValid: items.length > 0, items }
}

export const resolveScoreBreakdown = resolveCandidateScoreBreakdown

export function resolveSkillSignals(candidate = {}) {
  const explicitMatched = dedupe(normalizeList(
    firstNonEmptyArray(
      candidate?.fit_assessment?.matched_requirements,
      candidate?.matchedSkills,
      candidate?.matched_skills,
      candidate?.fit_assessment?.matched,
    ),
  ))
  const relevantSkills = dedupe(firstNonEmptyNormalizedList(
    candidate?.relevantSkills,
    candidate?.relevant_skills,
    candidate?.top_skills,
    candidate?.skills,
  ))
  const skillGaps = dedupe(normalizeList(
    firstNonEmptyArray(
      candidate?.fit_assessment?.missing_requirements,
      candidate?.missingSkills,
      candidate?.missing_skills,
      candidate?.fit_assessment?.missing,
    ),
  ))
  const legacyArrays = firstNonEmptyArray(
    candidate?.skillsList,
    candidate?.skill_list,
    candidate?.all_skills,
    candidate?.allSkills,
    candidate?.skillsArray,
  )
  const legacyCsv = normalizeCsvString(
    candidate?.skills_csv
    || candidate?.skillsCsv
    || candidate?.skill_csv
    || candidate?.skillCsv
    || candidate?.skills_string
    || candidate?.skillsString,
  )
  const allSkills = dedupe(firstNonEmptyNormalizedList(
    candidate?.allExtractedSkills,
    candidate?.skills_flat,
    flattenStructuredSkills(candidate?.skills_structured),
    candidate?.skills && typeof candidate.skills === 'object' && !Array.isArray(candidate.skills)
      ? flattenStructuredSkills(candidate.skills)
      : [],
    candidate?.top_skills,
    legacyArrays,
    legacyCsv,
  ))

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
