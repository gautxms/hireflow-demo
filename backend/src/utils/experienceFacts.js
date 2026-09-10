export const EXPERIENCE_FACTS_VERSION = 'experience_facts_v1'

const MAX_EXPERIENCE_ENTRIES = 30
const MAX_TITLE_LENGTH = 120
const MAX_COMPANY_LENGTH = 120
const MAX_DATE_LENGTH = 40
const MAX_DURATION_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500

const MONTHS = Object.freeze({
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
})

const PRESENT_PATTERN = /^(?:present|current|now|ongoing|till\s+date|to\s+date)$/i

function normalizeText(value, maxLength) {
  const scalarValues = Array.isArray(value)
    ? value.filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry)).join('; ')
    : value
  if (scalarValues === null || scalarValues === undefined || typeof scalarValues === 'object') return null
  const normalized = String(scalarValues).replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function normalizeReferenceDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  if (!Number.isFinite(date.getTime())) return new Date()
  return date
}

function monthOrdinal(year, month) {
  return (year * 12) + month - 1
}

function ordinalToYearMonth(ordinal) {
  const year = Math.floor(ordinal / 12)
  const month = (ordinal % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

function parseMonthValue(value, { allowPresent = false, referenceDate = new Date() } = {}) {
  const normalized = normalizeText(value, MAX_DATE_LENGTH)
  if (!normalized) return null

  if (allowPresent && PRESENT_PATTERN.test(normalized)) {
    return {
      ordinal: monthOrdinal(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1),
      precision: 'month',
      isPresent: true,
    }
  }

  let match = normalized.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    if (year >= 1900 && year <= 2200 && month >= 1 && month <= 12) {
      return { ordinal: monthOrdinal(year, month), precision: 'month', isPresent: false }
    }
  }

  match = normalized.match(/^([A-Za-z]{3,9})\s+(\d{4})$/)
  if (!match) match = normalized.match(/^(\d{4})\s+([A-Za-z]{3,9})$/)
  if (match) {
    const monthFirst = Number.isNaN(Number(match[1]))
    const monthName = monthFirst ? match[1] : match[2]
    const year = Number(monthFirst ? match[2] : match[1])
    const month = MONTHS[monthName.toLowerCase()]
    if (month && year >= 1900 && year <= 2200) {
      return { ordinal: monthOrdinal(year, month), precision: 'month', isPresent: false }
    }
  }

  match = normalized.match(/^(\d{4})$/)
  if (match) {
    const year = Number(match[1])
    if (year >= 1900 && year <= 2200) {
      return { ordinal: monthOrdinal(year, 1), precision: 'year', isPresent: false }
    }
  }

  return null
}

function parseDurationRange(value, referenceDate) {
  const normalized = normalizeText(value, MAX_DURATION_LENGTH)
  if (!normalized) return null

  const spacedParts = normalized.split(/\s+(?:-|–|—|to)\s+/i)
  const compactYearRange = normalized.match(/^(\d{4})\s*[-–—]\s*(\d{4}|present|current|now)$/i)
  const parts = spacedParts.length === 2
    ? spacedParts
    : (compactYearRange ? [compactYearRange[1], compactYearRange[2]] : [])
  if (parts.length !== 2) return null

  const start = parseMonthValue(parts[0], { referenceDate })
  const end = parseMonthValue(parts[1], { allowPresent: true, referenceDate })
  return start && end ? { start, end } : null
}

export function normalizeStructuredExperienceEntries(value, { maxItems = MAX_EXPERIENCE_ENTRIES } = {}) {
  if (!Array.isArray(value)) return []
  const parsedMaxItems = Number(maxItems)
  const itemLimit = Number.isFinite(parsedMaxItems)
    ? Math.max(0, Math.min(MAX_EXPERIENCE_ENTRIES, parsedMaxItems))
    : MAX_EXPERIENCE_ENTRIES

  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      title: normalizeText(entry.title ?? entry.role ?? entry.position, MAX_TITLE_LENGTH),
      company: normalizeText(entry.company ?? entry.organization ?? entry.employer, MAX_COMPANY_LENGTH),
      start_date: normalizeText(entry.startDate ?? entry.start_date ?? entry.start, MAX_DATE_LENGTH),
      end_date: normalizeText(entry.endDate ?? entry.end_date ?? entry.end, MAX_DATE_LENGTH),
      duration: normalizeText(entry.duration ?? entry.dates ?? entry.period, MAX_DURATION_LENGTH),
      description: normalizeText(
        entry.description ?? entry.summary ?? entry.highlights ?? entry.responsibilities,
        MAX_DESCRIPTION_LENGTH,
      ),
    }))
    .filter((entry) => Object.values(entry).some(Boolean))
    .slice(0, itemLimit)
}

function buildInterval(entry, index, referenceDate) {
  let start = parseMonthValue(entry.start_date, { referenceDate })
  let end = parseMonthValue(entry.end_date, { allowPresent: true, referenceDate })
  let source = 'structured_dates'

  if (!start || !end) {
    const duration = parseDurationRange(entry.duration, referenceDate)
    if (!duration) return null
    start = duration.start
    end = duration.end
    source = 'duration_range'
  }

  const referenceOrdinal = monthOrdinal(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1)
  const endCappedToReference = end.ordinal > referenceOrdinal
  if (endCappedToReference) end = { ...end, ordinal: referenceOrdinal }
  if (end.ordinal < start.ordinal) return null

  return {
    entry_index: index,
    start: start.ordinal,
    end: end.ordinal,
    start_date: ordinalToYearMonth(start.ordinal),
    end_date: ordinalToYearMonth(end.ordinal),
    duration_months: end.ordinal - start.ordinal,
    source,
    precision: start.precision === 'month' && end.precision === 'month' ? 'month' : 'year',
    is_current: end.isPresent,
    date_anomalies: endCappedToReference ? ['end_after_reference_date_capped'] : [],
  }
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) return { totalMonths: 0, overlapMonthsRemoved: 0 }
  const sorted = intervals.map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start || a.end - b.end)
  const summedMonths = sorted.reduce((total, interval) => total + interval.end - interval.start, 0)
  const merged = [sorted[0]]

  for (const interval of sorted.slice(1)) {
    const current = merged[merged.length - 1]
    if (interval.start <= current.end) current.end = Math.max(current.end, interval.end)
    else merged.push(interval)
  }

  const totalMonths = merged.reduce((total, interval) => total + interval.end - interval.start, 0)
  return { totalMonths, overlapMonthsRemoved: summedMonths - totalMonths }
}

export function buildExperienceFacts(value, { referenceDate } = {}) {
  const normalizedReferenceDate = normalizeReferenceDate(referenceDate)
  const entries = normalizeStructuredExperienceEntries(value)
  const intervals = entries
    .map((entry, index) => buildInterval(entry, index, normalizedReferenceDate))
    .filter(Boolean)
  const { totalMonths, overlapMonthsRemoved } = mergeIntervals(intervals)
  const unparsedEntryCount = entries.length - intervals.length
  const coverageRatio = entries.length > 0 ? intervals.length / entries.length : 0
  const hasYearPrecision = intervals.some((interval) => interval.precision === 'year')
  const hasDateAnomalies = intervals.some((interval) => interval.date_anomalies.length > 0)

  let confidence = 'unavailable'
  if (intervals.length > 0) {
    if (coverageRatio === 1 && !hasYearPrecision && !hasDateAnomalies) confidence = 'high'
    else if (coverageRatio >= 0.75) confidence = 'medium'
    else confidence = 'low'
  }

  const sources = new Set(intervals.map((interval) => interval.source))
  const source = intervals.length === 0
    ? 'unavailable'
    : (sources.size === 1 ? [...sources][0] : 'structured_dates_and_duration_ranges')

  return {
    version: EXPERIENCE_FACTS_VERSION,
    status: intervals.length > 0 ? 'computed' : 'unavailable',
    calculation_method: 'union_of_month_intervals',
    reference_date: normalizedReferenceDate.toISOString().slice(0, 10),
    total_months: intervals.length > 0 ? totalMonths : null,
    total_years: intervals.length > 0 ? Math.round((totalMonths / 12) * 10) / 10 : null,
    source,
    confidence,
    entry_count: entries.length,
    parsed_entry_count: intervals.length,
    unparsed_entry_count: unparsedEntryCount,
    date_coverage_ratio: Math.round(coverageRatio * 100) / 100,
    overlap_months_removed: overlapMonthsRemoved,
    entry_facts: intervals.map(({ start, end, ...interval }) => interval),
  }
}

export const __testables = {
  mergeIntervals,
  normalizeReferenceDate,
  parseDurationRange,
  parseMonthValue,
}
