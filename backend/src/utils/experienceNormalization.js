const EXPERIENCE_CONFIDENCE = new Set(['high', 'medium', 'low', 'unknown'])
const EXPERIENCE_SOURCE = new Set(['resume', 'ai_inferred', 'legacy_text_fallback', 'unknown'])

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function roundYears(value) {
  return Math.round(value * 100) / 100
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = toFiniteNumber(value)
    if (parsed !== null) return parsed
  }
  return null
}

function sumExperienceFromEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  let sum = 0
  let found = false

  for (const entry of entries) {
    const parsed = parseExperienceTextToYears(entry)
    if (parsed !== null) {
      sum += parsed
      found = true
    }
  }

  return found ? roundYears(sum) : null
}

export function parseExperienceTextToYears(input) {
  if (input === null || input === undefined) return null
  const text = String(input).trim().toLowerCase()
  if (!text) return null
  if (/\bfresher\b/.test(text)) return 0

  const hasExperienceContext = /(experience|years?|yrs?|months?|mos?\b|professional experience|work experience|total experience|relevant experience)/.test(text)
  if (!hasExperienceContext) return null

  const ym = text.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*(?:months?|mos?)\b/)
  if (ym) return roundYears(Number(ym[1]) + Number(ym[2]) / 12)

  const between = text.match(/between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/)
  if (between) return Number(between[1])

  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/)
  if (range) return Number(range[1])

  const monthsOnly = text.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?)\b/)
  if (monthsOnly) return roundYears(Number(monthsOnly[1]) / 12)

  const yearsOnly = text.match(/(?:more than|over|above|greater than|nearly|around|about|approximately)?\s*(\d+(?:\.\d+)?)(?:\+)?\s*(?:years?|yrs?)\b/)
  if (yearsOnly) return Number(yearsOnly[1])

  return null
}

export function normalizeCandidateExperience(candidate = {}) {
  const totalStructured = firstFiniteNumber(candidate?.totalExperienceYears, candidate?.years_experience, candidate?.experience_years)
  const relevantStructured = toFiniteNumber(candidate?.relevantExperienceYears)

  let totalExperienceYears = totalStructured
  let relevantExperienceYears = relevantStructured
  let experienceSource = EXPERIENCE_SOURCE.has(String(candidate?.experienceSource || '').toLowerCase())
    ? String(candidate.experienceSource).toLowerCase()
    : 'unknown'

  if (totalExperienceYears === null && relevantExperienceYears === null) {
    const parsedFromEntries = sumExperienceFromEntries(candidate?.experience)
    const fallbackText = candidate?.experienceLabel
      || (!Array.isArray(candidate?.experience) ? candidate?.experience : null)
      || candidate?.summary
      || null
    const parsed = parsedFromEntries ?? parseExperienceTextToYears(fallbackText)
    if (parsed !== null) {
      totalExperienceYears = parsed
      experienceSource = 'legacy_text_fallback'
    }
  }

  const experienceConfidence = EXPERIENCE_CONFIDENCE.has(String(candidate?.experienceConfidence || '').toLowerCase())
    ? String(candidate.experienceConfidence).toLowerCase()
    : (experienceSource === 'legacy_text_fallback' ? 'low' : 'unknown')

  const experienceEvidence = Array.isArray(candidate?.experienceEvidence) ? candidate.experienceEvidence.filter(Boolean).slice(0, 3) : []
  const experienceLabel = String(candidate?.experienceLabel || '').trim() || (totalExperienceYears !== null
    ? `${totalExperienceYears} years`
    : (relevantExperienceYears !== null ? `${relevantExperienceYears} years` : null))

  return {
    totalExperienceYears,
    relevantExperienceYears,
    experienceLabel,
    experienceConfidence,
    experienceEvidence,
    experienceSource,
  }
}
