const SORTABLE_FIELDS = new Set(['name', 'profileScore', 'yearsExperience', 'sourceUpdatedAt'])
const SORT_DIRECTIONS = new Set(['asc', 'desc'])
const PARSE_STATUSES = new Set(['queued', 'processing', 'complete', 'failed'])

export const candidateDirectoryQuerySchema = {
  defaults: {
    sortBy: 'sourceUpdatedAt',
    sortDirection: 'desc',
    page: 1,
    pageSize: 15,
  },
  limits: {
    minPage: 1,
    maxPage: 100000,
    minPageSize: 1,
    maxPageSize: 100,
  },
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function parseIntegerInRange(value, { fallback, min, max }) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}


function normalizeNumberFilter(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSortBy(value) {
  const normalized = normalizeString(value)
  if (!normalized || !SORTABLE_FIELDS.has(normalized)) return candidateDirectoryQuerySchema.defaults.sortBy
  return normalized
}

function normalizeSortDirection(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return SORT_DIRECTIONS.has(normalized) ? normalized : candidateDirectoryQuerySchema.defaults.sortDirection
}

function normalizeParseStatus(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return PARSE_STATUSES.has(normalized) ? normalized : null
}

export function normalizeCandidateDirectoryQuery(rawQuery = {}) {
  return {
    search: normalizeString(rawQuery.search),
    job: normalizeString(rawQuery.job),
    parseStatus: normalizeParseStatus(rawQuery.parseStatus),
    skills: normalizeString(rawQuery.skills),
    tags: normalizeString(rawQuery.tags),
    experienceMin: normalizeNumberFilter(rawQuery.experienceMin),
    experienceMax: normalizeNumberFilter(rawQuery.experienceMax),
    scoreMin: normalizeNumberFilter(rawQuery.scoreMin),
    scoreMax: normalizeNumberFilter(rawQuery.scoreMax),
    sourceJobId: normalizeString(rawQuery.sourceJobId),
    sourceAnalysisId: normalizeString(rawQuery.sourceAnalysisId),
    sortBy: normalizeSortBy(rawQuery.sortBy),
    sortDirection: normalizeSortDirection(rawQuery.sortDirection),
    page: parseIntegerInRange(rawQuery.page, {
      fallback: candidateDirectoryQuerySchema.defaults.page,
      min: candidateDirectoryQuerySchema.limits.minPage,
      max: candidateDirectoryQuerySchema.limits.maxPage,
    }),
    pageSize: parseIntegerInRange(rawQuery.pageSize, {
      fallback: candidateDirectoryQuerySchema.defaults.pageSize,
      min: candidateDirectoryQuerySchema.limits.minPageSize,
      max: candidateDirectoryQuerySchema.limits.maxPageSize,
    }),
  }
}

export function buildCandidateDirectoryQueryParams(rawQuery = {}) {
  const normalized = normalizeCandidateDirectoryQuery(rawQuery)
  const params = new URLSearchParams()

  Object.entries(normalized).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, String(value))
    }
  })

  return params.toString()
}
