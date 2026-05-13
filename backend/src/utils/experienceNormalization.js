const EXPERIENCE_CONFIDENCE = new Set(['high', 'medium', 'low', 'unknown'])
const EXPERIENCE_SOURCE = new Set(['resume', 'ai_inferred', 'legacy_text_fallback', 'interval_estimate', 'unknown'])

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

function normalizeDateToken(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  if (/^(present|current|now|ongoing)$/i.test(value)) return 'present'
  return value
}

function parseDateToMonthIndex(raw, { isEnd = false } = {}) {
  const normalized = normalizeDateToken(raw)
  if (!normalized) return null
  if (normalized === 'present') {
    const now = new Date()
    return (now.getUTCFullYear() * 12) + now.getUTCMonth()
  }

  const monthYear = normalized.match(/^(\d{1,2})[\/-](\d{4})$/)
  if (monthYear) {
    const month = Number(monthYear[1])
    const year = Number(monthYear[2])
    if (month >= 1 && month <= 12) return (year * 12) + (month - 1)
  }

  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear()
    const month = parsed.getUTCMonth()
    return (year * 12) + month
  }

  const yearOnly = normalized.match(/^\d{4}$/)
  if (yearOnly) {
    const year = Number(yearOnly[0])
    return (year * 12) + (isEnd ? 11 : 0)
  }

  return null
}

function mergeMonthIntervals(intervals = []) {
  const ordered = intervals
    .filter((entry) => entry && Number.isFinite(entry.start) && Number.isFinite(entry.end))
    .sort((a, b) => a.start - b.start)

  if (ordered.length === 0) return []

  const merged = [{ ...ordered[0] }]
  for (let i = 1; i < ordered.length; i += 1) {
    const current = ordered[i]
    const previous = merged[merged.length - 1]
    if (current.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, current.end)
      continue
    }
    merged.push({ ...current })
  }

  return merged
}

export function estimateExperienceFromWorkEntries(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return null

  const intervals = entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const startRaw = entry.startDate || entry.start_date || entry.from || entry.start
      const endRaw = entry.endDate || entry.end_date || entry.to || entry.end || 'Present'
      const start = parseDateToMonthIndex(startRaw, { isEnd: false })
      const end = parseDateToMonthIndex(endRaw, { isEnd: true })
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
      return { start, end, raw: { startRaw, endRaw } }
    })
    .filter(Boolean)

  if (intervals.length === 0) return null

  const merged = mergeMonthIntervals(intervals.map(({ start, end }) => ({ start, end })))
  const totalMonths = merged.reduce((sum, interval) => sum + ((interval.end - interval.start) + 1), 0)
  const estimatedExperienceYears = roundYears(totalMonths / 12)

  return {
    estimatedExperienceYears,
    totalMonths,
    isEstimated: true,
    source: 'interval_estimate',
    evidence: intervals.slice(0, 3).map(({ raw }) => `${raw.startRaw || '?'} → ${raw.endRaw || 'Present'}`),
  }
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
  const relevantExperienceYears = relevantStructured
  let experienceSource = EXPERIENCE_SOURCE.has(String(candidate?.experienceSource || '').toLowerCase())
    ? String(candidate.experienceSource).toLowerCase()
    : 'unknown'

  let estimatedExperienceYears = null
  let isEstimated = false
  let estimateEvidence = []

  if (totalExperienceYears === null && relevantExperienceYears === null) {
    const intervalEstimate = estimateExperienceFromWorkEntries(candidate?.experience)
    if (intervalEstimate?.estimatedExperienceYears != null) {
      totalExperienceYears = intervalEstimate.estimatedExperienceYears
      estimatedExperienceYears = intervalEstimate.estimatedExperienceYears
      isEstimated = true
      experienceSource = intervalEstimate.source
      estimateEvidence = intervalEstimate.evidence
    } else {
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
  }

  const experienceConfidence = EXPERIENCE_CONFIDENCE.has(String(candidate?.experienceConfidence || '').toLowerCase())
    ? String(candidate.experienceConfidence).toLowerCase()
    : (experienceSource === 'legacy_text_fallback' || experienceSource === 'interval_estimate' ? 'low' : 'unknown')

  const experienceEvidence = Array.isArray(candidate?.experienceEvidence) ? candidate.experienceEvidence.filter(Boolean).slice(0, 3) : []
  const displayExperienceYears = totalExperienceYears ?? relevantExperienceYears
  const experienceLabel = String(candidate?.experienceLabel || '').trim() || (displayExperienceYears !== null
    ? `${displayExperienceYears} years${isEstimated ? ' (estimated)' : ''}`
    : null)

  return {
    totalExperienceYears,
    relevantExperienceYears,
    experienceLabel,
    experienceConfidence,
    experienceEvidence,
    experienceSource,
    estimatedExperienceYears,
    isEstimated,
    source: experienceSource,
    evidence: isEstimated ? estimateEvidence : experienceEvidence,
  }
}
