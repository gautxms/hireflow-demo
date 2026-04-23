export const RESULTS_SORT_OPTIONS = new Set(['match_score', 'name', 'experience', 'upload_date'])

export function normalizeSortBy(sortBy) {
  return RESULTS_SORT_OPTIONS.has(sortBy) ? sortBy : 'match_score'
}

export function normalizeNumericRange(range = {}, bounds = { min: 0, max: Number.POSITIVE_INFINITY }) {
  const normalize = (value, min, max) => {
    if (value === '' || value === null || value === undefined) {
      return ''
    }

    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return ''
    }

    return String(Math.min(max, Math.max(min, parsed)))
  }

  const min = normalize(range.min, bounds.min, bounds.max)
  const max = normalize(range.max, bounds.min, bounds.max)

  if (min && max && Number(min) > Number(max)) {
    return { min: max, max: min }
  }

  return { min, max }
}

export function buildResultsQueryParams({
  searchText = '',
  selectedSkills = [],
  expRange = { min: '', max: '' },
  matchRange = { min: '', max: '' },
  sortBy = 'match_score',
  page = 1,
  pageSize = 25,
} = {}) {
  const params = new URLSearchParams()

  const normalizedSearch = String(searchText || '').trim()
  if (normalizedSearch) {
    params.set('search', normalizedSearch)
  }

  if (Array.isArray(selectedSkills) && selectedSkills.length > 0) {
    params.set('skills', selectedSkills.join(','))
  }

  if (expRange.min !== '') {
    params.set('experienceMin', String(expRange.min))
  }

  if (expRange.max !== '') {
    params.set('experienceMax', String(expRange.max))
  }

  if (matchRange.min !== '') {
    params.set('matchMin', String(matchRange.min))
  }

  if (matchRange.max !== '') {
    params.set('matchMax', String(matchRange.max))
  }

  params.set('sortBy', normalizeSortBy(sortBy))
  params.set('sortOrder', normalizeSortBy(sortBy) === 'name' ? 'asc' : 'desc')
  params.set('page', String(Math.max(1, Number(page) || 1)))
  params.set('pageSize', String(Math.max(1, Math.min(100, Number(pageSize) || 25))))

  return params
}

export function paginateCandidates(candidates, page, pageSize) {
  const safePageSize = Math.max(1, Number(pageSize) || 25)
  const total = candidates.length
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1))
  const offset = (safePage - 1) * safePageSize

  return {
    rows: candidates.slice(offset, offset + safePageSize),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
    },
  }
}

export function normalizeCandidateForResults(candidate, index = 0) {
  const isRenderable = Boolean(candidate && typeof candidate === 'object')
  const source = isRenderable ? candidate : {}
  const skillsValue = source.skills
  const normalizedSkills = Array.isArray(skillsValue)
    ? skillsValue
    : typeof skillsValue === 'string'
      ? skillsValue
      : ''

  return {
    ...source,
    skills: normalizedSkills,
    _bulkKey: String(source?.id ?? `${source?.name || 'candidate'}-${index}`),
    _isRenderable: isRenderable,
  }
}

export function hasRenderableCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return false
  }

  return candidates.some((candidate) => Boolean(candidate?._isRenderable))
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function resolveCandidateResumeUuid(candidate) {
  const possibleIds = [
    candidate?.resumeId,
    candidate?.resume_id,
    candidate?.id,
  ]

  for (const value of possibleIds) {
    if (typeof value === 'string' && UUID_PATTERN.test(value.trim())) {
      return value.trim()
    }
  }

  return null
}

const SCORE_STATE_BANDS = [
  {
    key: 'strong',
    min: 85,
    label: 'Strong match',
    icon: '⭐',
    chartColor: 'var(--color-success)',
    accentText: 'text-[var(--color-success-text)]',
    accentSubtleText: 'text-[var(--color-success)]',
    surfaceClass: 'bg-[var(--color-success-alpha-12)] border-[color:var(--color-success-alpha-35)]',
    badgeClass: 'bg-[var(--color-success-alpha-12)] text-[var(--color-success-text)] border-[color:var(--color-success-alpha-35)]',
  },
  {
    key: 'good',
    min: 70,
    label: 'Good match',
    icon: '👍',
    chartColor: 'var(--color-accent-green)',
    accentText: 'text-[var(--color-accent-green)]',
    accentSubtleText: 'text-[var(--color-accent-green)]',
    surfaceClass: 'bg-[var(--color-accent-alpha-08)] border-[color:var(--color-accent-alpha-15)]',
    badgeClass: 'bg-[var(--color-accent-alpha-08)] text-[var(--color-accent-green)] border-[color:var(--color-accent-alpha-15)]',
  },
  {
    key: 'consider',
    min: 55,
    label: 'Consider',
    icon: '⏳',
    chartColor: 'var(--color-warning-text)',
    accentText: 'text-[var(--color-warning-text)]',
    accentSubtleText: 'text-[var(--color-warning-text)]',
    surfaceClass: 'bg-[var(--color-warning-alpha-12)] border-[color:var(--color-warning-alpha-35)]',
    badgeClass: 'bg-[var(--color-warning-alpha-12)] text-[var(--color-warning-text)] border-[color:var(--color-warning-alpha-35)]',
  },
  {
    key: 'low',
    min: 0,
    label: 'Low match',
    icon: '⚠️',
    chartColor: 'var(--color-error)',
    accentText: 'text-[var(--color-error)]',
    accentSubtleText: 'text-[var(--color-error)]',
    surfaceClass: 'bg-[var(--color-danger-alpha-15)] border-[color:var(--color-danger-alpha-35)]',
    badgeClass: 'bg-[var(--color-danger-alpha-15)] text-[var(--color-error)] border-[color:var(--color-danger-alpha-35)]',
  },
]

const TIER_TO_SCORE_STATE = {
  top: 'strong',
  strong: 'good',
  consider: 'consider',
}

export function resolveCandidateScoreState(rawScore) {
  const score = Number(rawScore) || 0
  return SCORE_STATE_BANDS.find((band) => score >= band.min) || SCORE_STATE_BANDS[SCORE_STATE_BANDS.length - 1]
}

export function resolveRecommendationState(recommendation, score) {
  const value = String(recommendation || '').toLowerCase()
  if (value.includes('strong')) {
    return SCORE_STATE_BANDS[0]
  }

  if (value.includes('good')) {
    return SCORE_STATE_BANDS[1]
  }

  if (value.includes('possible') || value.includes('consider')) {
    return SCORE_STATE_BANDS[2]
  }

  return resolveCandidateScoreState(score)
}

export function resolveTierState(tier, score) {
  const normalizedTier = String(tier || '').toLowerCase()
  const mapped = TIER_TO_SCORE_STATE[normalizedTier]
  if (mapped) {
    return SCORE_STATE_BANDS.find((band) => band.key === mapped) || resolveCandidateScoreState(score)
  }

  return resolveCandidateScoreState(score)
}

export function toDisplayText(value, fallback = 'N/A') {
  if (value === null || value === undefined) {
    return fallback
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || fallback
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : fallback
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => toDisplayText(entry, ''))
      .filter(Boolean)
      .join(', ')
      .trim()
    return joined || fallback
  }

  if (typeof value === 'object') {
    if (typeof value.text === 'string' && value.text.trim()) {
      return value.text.trim()
    }

    if (typeof value.value === 'string' && value.value.trim()) {
      return value.value.trim()
    }

    return fallback
  }

  return fallback
}

export function toSafeScore(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(100, parsed))
}
