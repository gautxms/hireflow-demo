function clampText(value, maxLength = 200) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized || normalized === '[object Object]') return ''
  return normalized.slice(0, maxLength)
}

function normalizeGraduationYear(value) {
  if (value === null || value === undefined || value === '') return null
  const match = String(value).match(/\b(19|20)\d{2}\b/)
  if (!match) return null
  const year = Number(match[0])
  return Number.isFinite(year) ? year : null
}

function normalizeEducationObject(entry, { maxItemLength = 200 } = {}) {
  const degree = clampText(
    entry?.degree || entry?.qualification || entry?.program || entry?.course || '',
    maxItemLength,
  )
  const school = clampText(
    entry?.school || entry?.institution || entry?.university || entry?.college || '',
    maxItemLength,
  )
  const graduationYear = normalizeGraduationYear(entry?.graduation_year ?? entry?.graduationYear ?? entry?.year)
  const fallbackText = clampText(entry?.text || entry?.label || entry?.value || entry?.name || '', maxItemLength)

  if (degree || school || graduationYear !== null) {
    return {
      degree,
      school,
      graduation_year: graduationYear,
    }
  }

  return fallbackText || null
}

export function normalizeCandidateEducation(value, { maxItems = 20, maxItemLength = 200 } = {}) {
  const entries = Array.isArray(value) ? value : [value]
  const normalized = []

  for (const entry of entries) {
    if (entry === null || entry === undefined) continue

    if (typeof entry === 'string' || typeof entry === 'number') {
      const text = clampText(entry, maxItemLength)
      if (text) normalized.push(text)
    } else if (typeof entry === 'object' && !Array.isArray(entry)) {
      const education = normalizeEducationObject(entry, { maxItemLength })
      if (education) normalized.push(education)
    }

    if (normalized.length >= maxItems) break
  }

  return normalized
}

export function formatEducationForDisplay(value, fallback = '') {
  const entries = normalizeCandidateEducation(value)
  const labels = entries
    .map((entry) => {
      if (typeof entry === 'string') return entry
      const degree = clampText(entry?.degree)
      const school = clampText(entry?.school)
      const year = normalizeGraduationYear(entry?.graduation_year ?? entry?.graduationYear ?? entry?.year)
      const core = [degree, school].filter(Boolean).join(', ')
      return year ? `${core || 'Graduated'} (${year})` : core
    })
    .filter(Boolean)

  return labels.join(' | ') || fallback
}
