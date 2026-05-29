const OBJECT_PLACEHOLDER_PATTERN = /^\[object\s+object\]$/i

function clampText(value, maxLength = 200) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  if (!normalized || OBJECT_PLACEHOLDER_PATTERN.test(normalized)) return ''
  return normalized.slice(0, maxLength)
}

function joinParts(parts) {
  return parts.map((part) => clampText(part)).filter(Boolean).join(' — ')
}

function summarizeScalarValues(entry, { maxValues = 4, maxValueLength = 80 } = {}) {
  const values = []
  const visit = (value) => {
    if (values.length >= maxValues || value === null || value === undefined) return
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = clampText(value, maxValueLength)
      if (text) values.push(text)
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
    }
  }

  Object.values(entry || {}).forEach(visit)
  return [...new Set(values)].join(' — ')
}

function formatTechnologyList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => clampText(item, 50)).filter(Boolean).join(', ')
  }
  return clampText(value, 120)
}

export function summarizeEducationEntry(entry, { maxItemLength = 200 } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
  const degree = clampText(entry.degree || entry.qualification || entry.program || entry.course || entry.field_of_study || entry.fieldOfStudy, maxItemLength)
  const institution = clampText(entry.institution || entry.school || entry.university || entry.college, maxItemLength)
  const year = clampText(entry.year || entry.graduation_year || entry.graduationYear || entry.dates || entry.date, 40)
  const fallback = clampText(entry.text || entry.label || entry.value || entry.name, maxItemLength)
  const label = [degree, institution].filter(Boolean).join(', ') || fallback
  if (label && year) return `${label} (${year})`.slice(0, maxItemLength)
  return (label || summarizeScalarValues(entry)).slice(0, maxItemLength)
}

export function summarizeExperienceEntry(entry, { maxItemLength = 220 } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
  const title = clampText(entry.title || entry.role || entry.position, 100)
  const company = clampText(entry.company || entry.organization || entry.employer, 100)
  const dates = clampText(entry.dates || entry.duration || entry.period || [entry.startDate || entry.start, entry.endDate || entry.end].filter(Boolean).join(' - '), 80)
  const summary = clampText(entry.summary || entry.description || entry.highlights || entry.responsibilities, 140)
  const headline = joinParts([[title, company].filter(Boolean).join(' at '), dates])
  const formatted = [headline, summary].filter(Boolean).join(': ')
  return (formatted || summarizeScalarValues(entry)).slice(0, maxItemLength)
}

export function summarizeProjectEntry(entry, { maxItemLength = 200 } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
  const name = clampText(entry.name || entry.title, 100)
  const description = clampText(entry.description || entry.summary || entry.details, 140)
  const technologies = formatTechnologyList(entry.technologies || entry.tech || entry.stack || entry.tools)
  const techText = technologies ? `Technologies: ${technologies}` : ''
  const formatted = [name, description, techText].filter(Boolean).join(' — ')
  return (formatted || summarizeScalarValues(entry)).slice(0, maxItemLength)
}

export function summarizeCandidateFieldEntry(entry, fieldName = '', { maxItemLength = 200 } = {}) {
  if (entry === null || entry === undefined) return ''
  if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
    return clampText(entry, maxItemLength)
  }
  if (Array.isArray(entry)) {
    return entry.map((item) => summarizeCandidateFieldEntry(item, fieldName, { maxItemLength })).filter(Boolean).join(', ').slice(0, maxItemLength)
  }
  if (typeof entry !== 'object') return ''

  if (fieldName === 'education') return summarizeEducationEntry(entry, { maxItemLength })
  if (fieldName === 'experience') return summarizeExperienceEntry(entry, { maxItemLength })
  if (fieldName === 'projects') return summarizeProjectEntry(entry, { maxItemLength })

  const knownText = clampText(entry.text || entry.label || entry.value || entry.name || entry.title, maxItemLength)
  return knownText || summarizeScalarValues(entry, { maxValueLength: maxItemLength }).slice(0, maxItemLength)
}

export function normalizeCandidateFieldArray(value, { fieldName = '', maxItems = 20, maxItemLength = 200 } = {}) {
  const entries = Array.isArray(value) ? value : [value]
  const normalized = []
  for (const entry of entries) {
    const text = summarizeCandidateFieldEntry(entry, fieldName, { maxItemLength })
    if (text && !OBJECT_PLACEHOLDER_PATTERN.test(text)) {
      normalized.push(text)
    }
    if (normalized.length >= maxItems) break
  }
  return normalized
}

export const __testables = { clampText, summarizeScalarValues }
