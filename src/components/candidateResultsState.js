import { buildResumeFileIdentity } from '../utils/resumeFileIdentity.js'

export const RESULTS_SORT_OPTIONS = new Set(['match_score', 'name', 'experience', 'upload_date'])

export function normalizeSortBy(sortBy) {
  if (sortBy === 'score') return 'match_score'
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
    candidateKey: resolveCandidateKey(source, index),
    _bulkKey: String(source?.id ?? `${source?.name || 'candidate'}-${index}`),
    _isRenderable: isRenderable,
  }
}

export function resolveCandidateKey(candidate = {}, index = 0) {
  const canonicalFields = [
    candidate?.candidateKey,
    candidate?.resumeId,
    candidate?.resume_id,
    candidate?.id,
    candidate?.email,
  ]

  for (const value of canonicalFields) {
    const normalized = String(value || '').trim()
    if (normalized) return normalized
  }

  const normalizedName = String(candidate?.name || '').trim()
  if (normalizedName) {
    return `${normalizedName}-${index}`
  }

  return `candidate-${index}`
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




function toSkillLabel(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'object') {
    if (typeof value.name === 'string' && value.name.trim()) return value.name.trim()
    if (typeof value.label === 'string' && value.label.trim()) return value.label.trim()
  }
  return ''
}

function collectSkillsFromValue(value, collector) {
  if (!value) return
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSkillsFromValue(entry, collector))
    return
  }

  if (typeof value === 'string') {
    value.split(',').forEach((entry) => {
      const label = entry.trim()
      if (label) collector(label)
    })
    return
  }

  if (typeof value === 'object') {
    const label = toSkillLabel(value)
    if (label) {
      collector(label)
      return
    }

    Object.values(value).forEach((entry) => collectSkillsFromValue(entry, collector))
    return
  }

  const label = toSkillLabel(value)
  if (label) collector(label)
}

const ROOT_SKILL_BUCKET_FIELDS = [
  'technical_skills',
  'soft_skills',
  'tools_and_platforms',
  'methodologies',
  'domain_expertise',
  'languages',
  'frameworks',
  'databases',
  'cloud',
  'cloud_platforms',
  'bi_tools',
]

export function resolveFilterableSkills(candidate = {}) {
  const deduped = new Map()
  const addSkill = (skill) => {
    const label = String(skill || '').trim()
    if (!label) return
    const key = label.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, label)
    }
  }

  collectSkillsFromValue(candidate?.top_skills, addSkill)
  collectSkillsFromValue(candidate?.skills_flat, addSkill)
  collectSkillsFromValue(candidate?.skills, addSkill)
  collectSkillsFromValue(candidate?.skills_structured, addSkill)
  ROOT_SKILL_BUCKET_FIELDS.forEach((field) => {
    collectSkillsFromValue(candidate?.[field], addSkill)
  })

  return Array.from(deduped.values())
}

export function resolveCandidateYears(candidate = {}) {
  const candidates = [
    candidate?.years_experience,
    candidate?.yearsExperience,
    candidate?.experience_years,
    candidate?.experience,
  ]

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue

      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        return Number(trimmed)
      }

      const match = trimmed.match(/(\d+(?:\.\d+)?)/)
      if (match) {
        const numeric = Number(match[1])
        if (Number.isFinite(numeric)) {
          return numeric
        }
      }
    }
  }

  return 0
}

export function sortCandidatesForResults(candidates = [], sortBy = 'match_score', getUploadDate = () => 0) {
  const normalizedSort = normalizeSortBy(sortBy)
  return [...candidates].sort((a, b) => {
    if (normalizedSort === 'name') {
      return String(a?.name || '').localeCompare(String(b?.name || ''))
    }
    if (normalizedSort === 'experience') {
      return resolveCandidateYears(b) - resolveCandidateYears(a)
    }
    if (normalizedSort === 'upload_date') {
      return Number(getUploadDate(b) || 0) - Number(getUploadDate(a) || 0)
    }
    return Number(resolveActiveCandidateScore(b) || 0) - Number(resolveActiveCandidateScore(a) || 0)
  })
}

function parseSkillList(skills) {
  return resolveFilterableSkills({ skills })
}

export function resolveActiveCandidateScore(candidate = {}) {
  const possibleScores = [
    candidate?.matchScore?.score,
    candidate?.matchScore,
    candidate?.score,
    candidate?.profile_score,
    candidate?.scoreBreakdown?.overall,
    candidate?.overall_score,
    candidate?.overallScore,
    candidate?.total_score,
    candidate?.totalScore,
  ]

  for (const rawScore of possibleScores) {
    if (rawScore == null) {
      continue
    }

    const numeric = Number(rawScore)
    if (Number.isFinite(numeric)) {
      return numeric
    }
  }

  return null
}

export function buildCandidateRenderContract(candidate = {}) {
  const score = resolveActiveCandidateScore(candidate)
  const scoreTenPoint = score == null ? null : (score / 10).toFixed(1)
  const scoreTier = score == null ? 'unscored' : score >= 80 ? 'strong' : score >= 60 ? 'possible' : 'low'
  const topSkills = Array.isArray(candidate?.top_skills) && candidate.top_skills.length > 0
    ? candidate.top_skills
    : parseSkillList(candidate?.skills)

  return {
    name: toDisplayText(candidate?.name),
    location: toDisplayText(candidate?.location),
    yearsExperience: candidate?.years_experience != null ? `${candidate.years_experience} yrs exp` : '',
    score,
    scoreTenPoint,
    scoreTier,
    topSkills: topSkills.slice(0, 3),
  }
}
function cleanDisplayString(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return fallback
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  if (!normalized || /^\[object\s+object\]$/i.test(normalized)) return fallback
  return normalized
}

function joinDisplayParts(parts, separator = ' — ') {
  return parts.map((part) => cleanDisplayString(part, '')).filter(Boolean).join(separator)
}

export function formatCandidateFieldForDisplay(value, fallback = 'N/A', fieldName = '') {
  if (value === null || value === undefined) return fallback

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    return cleanDisplayString(value, fallback)
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => formatCandidateFieldForDisplay(entry, '', fieldName))
      .filter(Boolean)
      .join(', ')
      .trim()
    return joined || fallback
  }

  if (typeof value === 'object') {
    if (fieldName === 'education') {
      const degree = cleanDisplayString(value.degree || value.qualification || value.program || value.course || value.field_of_study || value.fieldOfStudy, '')
      const school = cleanDisplayString(value.school || value.institution || value.university || value.college, '')
      const year = cleanDisplayString(value.graduation_year || value.graduationYear || value.year || value.dates, '')
      const label = [degree, school].filter(Boolean).join(', ') || cleanDisplayString(value.text || value.label || value.value || value.name, '')
      if (label) return year ? `${label} (${year})` : label
    }

    if (fieldName === 'experience') {
      const title = cleanDisplayString(value.title || value.role || value.position, '')
      const company = cleanDisplayString(value.company || value.organization || value.employer, '')
      const dates = cleanDisplayString(value.dates || value.duration || value.period || [value.startDate || value.start, value.endDate || value.end].filter(Boolean).join(' - '), '')
      const summary = formatCandidateFieldForDisplay(value.summary || value.description || value.highlights || value.responsibilities, '', '')
      const headline = joinDisplayParts([[title, company].filter(Boolean).join(' at '), dates])
      const label = [headline, summary].filter(Boolean).join(': ')
      if (label) return label
    }

    if (fieldName === 'projects') {
      const name = cleanDisplayString(value.name || value.title, '')
      const description = formatCandidateFieldForDisplay(value.description || value.summary || value.details, '', '')
      const technologies = formatCandidateFieldForDisplay(value.technologies || value.tech || value.stack || value.tools, '', '')
      const label = joinDisplayParts([name, description, technologies ? `Technologies: ${technologies}` : ''])
      if (label) return label
    }

    const direct = cleanDisplayString(value.text || value.value || value.label, '')
    if (direct) return direct

    if (!fieldName) return fallback

    const scalarValues = Object.values(value)
      .map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? cleanDisplayString(entry, '') : ''))
      .filter(Boolean)
    return [...new Set(scalarValues)].slice(0, 4).join(' — ') || fallback
  }

  return fallback
}

export function toDisplayText(value, fallback = 'N/A') {
  return formatCandidateFieldForDisplay(value, fallback)
}



const COMPLETE_AI_TEXT_ENDING = /[.!?…;:)\]}"'’”]$/
const TECHNICAL_DISPLAY_TOKEN = /^(?:[A-Z]{2,}|[A-Z][a-z]+(?:\.[a-z]+)+|[A-Z]\.[A-Za-z]+|[A-Za-z]+(?:\.[A-Za-z]+)+|[A-Za-z0-9]+(?:[/-][A-Za-z0-9.]+)+|\d+(?:[.–-]\d+)?|\d+(?:\.\d+)?|PostgreSQL)$/
const TRAILING_FRAGMENT_PATTERN = /(?:\s+(?:with|for|and|or|but|to|of|in|on|at|as|by|from|while|where|that|which|who|when|because)\s+[A-Za-z]{1,8}|\s+[A-Za-z]{1,3}|\s+[A-Z][a-z]{3,5})$/

function appendDisplayEllipsis(text) {
  const cleaned = String(text || '').trim().replace(/[\s,;:–—-]+$/, '')
  return cleaned ? `${cleaned}…` : ''
}

export function cleanAiTextForDisplay(value, fallback = '') {
  const normalizedFallback = fallback == null ? '' : String(fallback)
  const text = toDisplayText(value, normalizedFallback)
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return normalizedFallback
  if (COMPLETE_AI_TEXT_ENDING.test(text)) return text

  const words = text.split(/\s+/).filter(Boolean)
  const lastWord = words[words.length - 1]?.replace(/^[([{"'‘“]+|[),.;:!?\]}'’”]+$/g, '') || ''
  const hasLikelySentenceContext = /[,;:]|\s(?:with|without|because|while|but|although|including|demonstrated|experience|ability|candidate|requirement|requirements)\s/i.test(text)
  const hasShortVerdictFragment = /[–—-]/.test(text) && /\s+[A-Z][a-z]{3,5}$/.test(text)

  if (words.length <= 4 && TECHNICAL_DISPLAY_TOKEN.test(lastWord)) return text
  if (words.length <= 4 && !/[–—-]/.test(text)) return text

  if (TRAILING_FRAGMENT_PATTERN.test(text) && (hasLikelySentenceContext || hasShortVerdictFragment || text.length >= 60)) {
    return appendDisplayEllipsis(text.replace(TRAILING_FRAGMENT_PATTERN, '')) || text
  }

  return text
}

function normalizeDisplayNarrative(value, fallback = '') {
  return cleanAiTextForDisplay(value, fallback)
}

function firstDisplayNarrative(candidates, fallback = '') {
  for (const value of candidates) {
    const normalized = normalizeDisplayNarrative(value, '')
    if (normalized) return normalized
  }
  return normalizeDisplayNarrative('', fallback)
}

function normalizeSimilarityText(value) {
  if (typeof value !== 'string') return ''

  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(?:\.{3}|…)+$/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const SIMILARITY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'but', 'by', 'candidate',
  'did', 'does', 'due', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'of',
  'on', 'or', 's', 'strong', 'that', 'the', 'their', 'this', 'to', 'with',
])

const ACTION_ORIENTED_RECOMMENDATION_PATTERNS = [
  /\b(?:do\s+not\s+)?shortlist(?:\s+for\b|\s+to\b|\b)/,
  /\bschedule\s+(?:an?\s+)?(?:interview|recruiter\s+screen|phone\s+screen|screen)\b/,
  /\bproceed\s+to\s+(?:interview|recruiter\s+screen|phone\s+screen|screen|next\s+step|next\s+round)\b/,
  /\badvance\s+to\s+(?:interview|recruiter\s+screen|phone\s+screen|screen|next\s+step|next\s+round)\b/,
  /\bmove\s+forward\s+with\s+(?:interview|recruiter\s+screen|phone\s+screen|screen|candidate|application)\b/,
  /\bput\s+(?:the\s+candidate\s+|her\s+|him\s+|them\s+)?on\s+hold\b/,
  /\bhold\s+(?:for|until)\b/,
  /\breject\s+(?:for|from)\b/,
  /\bfollow\s+up\s+(?:with|on|about|to)\b/,
  /\b(?:confirm|verify|validate|clarify|probe|assess|check)\s+\w+/,
  /\bask\s+(?:about|for|whether|if)\s+\w+/,
  /\bconsider\s+(?:her\s+|him\s+|them\s+|the\s+candidate\s+)?for\s+\w+/,
]

function normalizeSimilarityToken(token) {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function similarityTokens(normalizedText) {
  return normalizedText
    .split(' ')
    .map(normalizeSimilarityToken)
    .filter((token) => token.length > 1 && !SIMILARITY_STOP_WORDS.has(token))
}

export function isActionOrientedRecommendation(text) {
  const recommendation = normalizeSimilarityText(text)
  if (!recommendation) return false

  return ACTION_ORIENTED_RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(recommendation))
}

function hasActionGuidanceTail(recommendation, reasoning) {
  if (recommendation.length <= reasoning.length) return false

  const extraText = recommendation.includes(reasoning)
    ? recommendation.replace(reasoning, ' ')
    : recommendation

  return isActionOrientedRecommendation(extraText)
}

export function isClearlyDuplicativeDisplayText(recommendationText, reasoningText) {
  const recommendation = normalizeSimilarityText(recommendationText)
  const reasoning = normalizeSimilarityText(reasoningText)

  if (!recommendation || !reasoning) return false
  if (recommendation === reasoning) return true

  const recommendationToReasoningRatio = recommendation.length / reasoning.length

  if (recommendation.length >= 36 && recommendationToReasoningRatio <= 1 && recommendationToReasoningRatio >= 0.6 && reasoning.includes(recommendation)) {
    return true
  }

  const recommendationWords = recommendation.split(' ')
  const reasoningWords = reasoning.split(' ')
  if (recommendationWords.length >= 8 && recommendationToReasoningRatio <= 1 && recommendationToReasoningRatio >= 0.6) {
    const recommendationPhrase = recommendationWords.join(' ')
    if (reasoningWords.slice(0, recommendationWords.length).join(' ') === recommendationPhrase) {
      return true
    }
  }

  const shorter = recommendation.length <= reasoning.length ? recommendation : reasoning
  const longer = recommendation.length > reasoning.length ? recommendation : reasoning

  if (shorter.length < 32 || longer.length < 40) return false

  const recommendationTokens = new Set(similarityTokens(recommendation))
  const reasoningTokens = new Set(similarityTokens(reasoning))
  const smallerTokenCount = Math.min(recommendationTokens.size, reasoningTokens.size)
  const largerTokenCount = Math.max(recommendationTokens.size, reasoningTokens.size)

  if (smallerTokenCount < 5) return false

  let overlap = 0
  for (const token of recommendationTokens) {
    if (reasoningTokens.has(token)) overlap += 1
  }

  const union = recommendationTokens.size + reasoningTokens.size - overlap
  const containment = overlap / smallerTokenCount
  const jaccard = union > 0 ? overlap / union : 0
  const recommendationTokenSurplus = recommendationTokens.size - reasoningTokens.size

  if (recommendationTokenSurplus > 0 && hasActionGuidanceTail(recommendation, reasoning)) {
    return false
  }

  if (recommendationTokenSurplus > 2) {
    return false
  }

  return containment >= 0.86 && jaccard >= 0.62 && largerTokenCount - smallerTokenCount <= 5
}

function firstDisplayArray(candidates) {
  for (const value of candidates) {
    const normalized = toAiDisplayArray(value)
    if (normalized.length > 0) return normalized
  }
  return []
}

function normalizeEducationRecord(record) {
  if (record == null) return null

  if (typeof record === 'string') {
    const text = cleanDisplayString(record, '')
    return text ? { degree: text, school: '', graduationYear: '', text } : null
  }

  if (typeof record !== 'object' || Array.isArray(record)) return null

  const degree = formatCandidateFieldForDisplay(record.degree || record.qualification || record.program || record.course || record.field_of_study || record.fieldOfStudy, '').trim()
  const school = formatCandidateFieldForDisplay(record.school || record.institution || record.university || record.college, '').trim()
  const graduationYear = formatCandidateFieldForDisplay(record.graduation_year || record.graduationYear || record.year || record.dates, '').trim()
  const fallbackText = formatCandidateFieldForDisplay(record, '', 'education').trim()

  if (!degree && !school && !fallbackText) return null

  return {
    degree,
    school,
    graduationYear,
    text: fallbackText,
  }
}

function educationRank(record) {
  const text = `${record?.degree || ''} ${record?.text || ''}`.toLowerCase()
  if (/\b(ph\.?d|doctorate|doctoral|md)\b/.test(text)) return 4
  if (/\b(master|mba|mtech|m\.tech|ms\b|m\.s\b|msc|m\.sc|ma\b|m\.a\b)\b/.test(text)) return 3
  if (/\b(bachelor|btech|b\.tech|be\b|b\.e\b|bs\b|b\.s\b|ba\b|b\.a\b|bsc|b\.sc)\b/.test(text)) return 2
  if (/\b(diploma|certificate|certification)\b/.test(text)) return 1
  return 0
}

function resolveGraduationYearWeight(record) {
  const yearMatch = String(record?.graduationYear || '').match(/\b(19|20)\d{2}\b/)
  return yearMatch ? Number(yearMatch[0]) : -1
}

export function resolveEducationLabel(education, fallback = 'Education details unavailable') {
  const records = (Array.isArray(education) ? education : [education])
    .map((entry) => normalizeEducationRecord(entry))
    .filter(Boolean)

  if (!records.length) return fallback

  const [best] = records
    .map((record, index) => ({
      record,
      index,
      rank: educationRank(record),
      graduationYearWeight: resolveGraduationYearWeight(record),
    }))
    .sort((a, b) => b.rank - a.rank || b.graduationYearWeight - a.graduationYearWeight || a.index - b.index)

  const selected = best.record
  const degree = selected.degree
  const school = selected.school
  const year = resolveGraduationYearWeight(selected) > 0 ? String(resolveGraduationYearWeight(selected)) : ''

  let label = ''
  if (degree && school) label = `${degree} — ${school}`
  else if (degree) label = degree
  else if (school) label = school
  else label = selected.text

  if (!label) return fallback
  return year ? `${label} (${year})` : label
}

export function toSafeScore(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(100, parsed))
}

export function parseScorePercentage(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) return Math.round(value * 100)
    if (value >= 0 && value <= 100) return Math.round(value)
    return null
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const percentMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*%/)
  if (percentMatch) {
    const numeric = Number(percentMatch[1])
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? Math.round(numeric) : null
  }

  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) return null
  if (numeric >= 0 && numeric <= 1) return Math.round(numeric * 100)
  if (numeric >= 0 && numeric <= 100) return Math.round(numeric)
  return null
}

export function resolveScoreBreakdownMetric(matchBreakdown, keys = [], fallback = null) {
  if (!matchBreakdown || typeof matchBreakdown !== 'object') return parseScorePercentage(fallback)
  for (const key of keys) {
    if (!key || !(key in matchBreakdown)) continue
    const parsed = parseScorePercentage(matchBreakdown[key])
    if (parsed != null) return parsed
  }
  return parseScorePercentage(fallback)
}

export function buildScoreBreakdownRows(candidate = {}) {
  const matchBreakdown = candidate?.matchScore?.breakdown
    || candidate?.match_score?.breakdown
    || candidate?.scoreBreakdown
    || candidate?.score_breakdown
  const roleAlignmentValue = resolveScoreBreakdownMetric(
    matchBreakdown,
    ['role_alignment', 'roleAlignment', 'role_fit', 'roleFit', 'job_alignment'],
    candidate?.fit_assessment?.role_alignment
      ?? candidate?.fit_assessment?.roleAlignment
      ?? candidate?.fit_assessment?.role_fit
      ?? candidate?.fit_assessment?.roleFit
      ?? candidate?.fit_assessment?.job_alignment
      ?? null,
  )

  return [
    {
      label: 'Skill Match',
      value: resolveScoreBreakdownMetric(matchBreakdown, ['technical_skills', 'skills_match', 'skills', 'technicalSkills', 'skill_match_score'], candidate?.fit_assessment?.skill_match_score ?? null),
    },
    {
      label: 'Experience',
      value: resolveScoreBreakdownMetric(matchBreakdown, ['experience_years', 'experience', 'years_experience', 'experienceYears', 'experience_match_score'], candidate?.fit_assessment?.experience_match_score ?? null),
    },
    {
      label: 'Education',
      value: resolveScoreBreakdownMetric(matchBreakdown, ['education', 'education_match', 'academic_background', 'educationMatch', 'education_match_score'], candidate?.fit_assessment?.education_match_score ?? null),
    },
    ...(Number.isFinite(roleAlignmentValue) ? [{ label: 'Role Alignment', value: roleAlignmentValue }] : []),
  ].filter((row) => Number.isFinite(row.value))
}

function toStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => formatCandidateFieldForDisplay(entry, '')).filter(Boolean)
}

function toAiDisplayArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => cleanAiTextForDisplay(entry, '')).filter(Boolean)
}


function pickFullerArrayValue(...values) {
  let best = []
  let bestScore = 0
  for (const value of values) {
    const normalized = toAiDisplayArray(value)
    if (!normalized.length) continue
    const score = normalized.reduce((total, entry) => total + entry.length, 0)
    if (score > bestScore) {
      best = normalized
      bestScore = score
    }
  }
  return best
}

function mergeUniqueDisplayArrays(...arrays) {
  const output = []
  const seen = new Set()
  for (const array of arrays) {
    for (const entry of Array.isArray(array) ? array : []) {
      const cleaned = cleanAiTextForDisplay(entry, '')
      if (!cleaned) continue
      const key = cleaned.toLowerCase().replace(/…$/u, '').trim()
      const duplicateIndex = output.findIndex((existing) => {
        const existingKey = existing.toLowerCase().replace(/…$/u, '').trim()
        return existingKey === key || existingKey.startsWith(key) || key.startsWith(existingKey)
      })
      if (duplicateIndex >= 0) {
        if (cleaned.length > output[duplicateIndex].length) {
          seen.delete(output[duplicateIndex].toLowerCase())
          output[duplicateIndex] = cleaned
          seen.add(key)
        }
        continue
      }
      seen.add(key)
      output.push(cleaned)
    }
  }
  return output
}

function toPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function sanitizeExpandedCandidate(candidate = {}) {
  const source = toPlainObject(candidate)
  const fitAssessment = toPlainObject(source.fit_assessment)
  const skillsStructured = toPlainObject(source.skills_structured)
  const scoreBreakdownSource = toPlainObject(source.scoreBreakdown)

  const scoreBreakdown = Object.fromEntries(
    Object.entries(scoreBreakdownSource).map(([key, value]) => [String(key), value]),
  )

  return {
    ...source,
    name: toDisplayText(source.name, 'Candidate'),
    summary: toDisplayText(source.summary, ''),
    current_title: toDisplayText(source.current_title, ''),
    location: toDisplayText(source.location, ''),
    seniority_level: toDisplayText(source.seniority_level, ''),
    education: source.education,
    education_label: resolveEducationLabel(source.education, ''),
    email: toDisplayText(source.email, ''),
    years_experience: toDisplayText(source.years_experience, ''),
    skills: Array.isArray(source.skills) ? source.skills : (typeof source.skills === 'string' ? source.skills : []),
    top_skills: toStringArray(source.top_skills),
    strengths: toAiDisplayArray(source.strengths),
    achievements: toAiDisplayArray(source.achievements),
    considerations: toAiDisplayArray(source.considerations || source.risks_or_gaps || source.concerns),
    mustHaveSkills: toAiDisplayArray(source.mustHaveSkills),
    missingSkills: toAiDisplayArray(source.missingSkills || source.missing_requirements),
    experience: Array.isArray(source.experience) ? source.experience.map((entry) => cleanAiTextForDisplay(formatCandidateFieldForDisplay(entry, '', 'experience'), '')).filter(Boolean) : [],
    projects: Array.isArray(source.projects) ? source.projects.map((entry) => formatCandidateFieldForDisplay(entry, '', 'projects')).filter(Boolean) : [],
    integrity_checks: Array.isArray(source.integrity_checks) ? source.integrity_checks : [],
    fit_assessment: {
      ...fitAssessment,
      matched: pickFullerArrayValue(fitAssessment.matched_requirements, fitAssessment.matched),
      missing: pickFullerArrayValue(fitAssessment.missing_requirements, fitAssessment.missing),
      reason: cleanAiTextForDisplay(fitAssessment.reason || fitAssessment.rationale, ''),
      rationale: cleanAiTextForDisplay(fitAssessment.rationale, ''),
      risk: cleanAiTextForDisplay(fitAssessment.risk || fitAssessment.risks_or_gaps, ''),
      risks_or_gaps: toAiDisplayArray(fitAssessment.risks_or_gaps),
      confidence: toDisplayText(fitAssessment.confidence, ''),
      verdict: cleanAiTextForDisplay(fitAssessment.verdict, ''),
    },
    skills_structured: {
      ...skillsStructured,
      tools_and_platforms: toStringArray(skillsStructured.tools_and_platforms),
      methodologies: toStringArray(skillsStructured.methodologies),
      domain_expertise: toStringArray(skillsStructured.domain_expertise),
      soft_skills: toStringArray(skillsStructured.soft_skills),
    },
    scoreBreakdown,
    matchScore: typeof source.matchScore === 'number'
      ? source.matchScore
      : {
        ...toPlainObject(source.matchScore),
        reason: cleanAiTextForDisplay(source?.matchScore?.reason, ''),
      },
  }
}



function resolveNumericConfidence(candidate) {
  const possibleValues = [
    candidate?.confidenceScores?.fit_assessment,
    candidate?.confidence?.fit_assessment,
    candidate?.fit_assessment?.confidence_score,
    candidate?.fit_assessment?.confidenceScore,
  ]

  for (const value of possibleValues) {
    if (value == null) continue
    if (typeof value === 'string' && value.trim() === '') continue

    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.min(1, numeric))
    }
  }

  return null
}

function resolveDrawerConfidenceLabel(candidate, hasScore) {
  const explicitConfidence = [
    candidate?.fit_assessment?.confidence,
    candidate?.confidence,
    candidate?.match_confidence,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean)

  if (explicitConfidence) {
    return explicitConfidence
  }

  const numericConfidence = resolveNumericConfidence(candidate)
  if (numericConfidence != null) {
    if (numericConfidence >= 0.85) return 'High confidence'
    if (numericConfidence >= 0.65) return 'Moderate confidence'
    return 'Low confidence'
  }

  return hasScore ? '' : 'Low confidence'
}

export function buildExpandedCandidateDrawerViewModel(rawCandidate) {
  try {
    const candidate = sanitizeExpandedCandidate(rawCandidate)
    const score = resolveActiveCandidateScore(candidate)
    const normalized = Number(score)
    const tenPoint = Number.isFinite(normalized) && normalized >= 0 ? Math.max(0, Math.min(10, (normalized > 10 ? normalized / 10 : normalized))) : null
    const tier = tenPoint == null ? 'unscored' : tenPoint >= 8 ? 'strong' : tenPoint >= 6 ? 'possible' : 'low'
    const displayScore = tenPoint == null ? null : tenPoint.toFixed(1)
    const hasDisplayScore = displayScore != null

    const candidateTitle = toDisplayText(candidate.current_title, '')
    const yearsRaw = Number(candidate.years_experience)
    const yearsNumber = Number.isFinite(yearsRaw) ? yearsRaw : null
    const experienceLabel = yearsNumber != null ? `${yearsNumber} yrs exp` : '0 yrs exp'
    const experienceYearsLabel = yearsNumber != null ? `${yearsNumber} years` : '0 years'
    const locationLabel = toDisplayText(candidate.location, 'Location unavailable')
    const seniorityLabel = toDisplayText(candidate.seniority_level, '')
    const summaryText = firstDisplayNarrative([candidate.summaryFull, candidate?.displayText?.summary?.full, candidate?.rawDisplayFields?.summary, candidate.summary], 'No summary available.')
    const reasoningText = firstDisplayNarrative([candidate.reasoningFull, candidate?.displayText?.reasoning?.full, candidate?.rawDisplayFields?.reasoning, candidate?.matchScore?.reasonFull, candidate?.fit_assessment?.reasonFull, candidate?.matchScore?.reason, candidate?.fit_assessment?.reason], 'Reasoning unavailable for this profile.')
    const resolvedRecommendationText = firstDisplayNarrative([candidate.recommendationFull, candidate?.displayText?.recommendation?.full, candidate?.rawDisplayFields?.recommendation, candidate?.recommendation, candidate?.fit_assessment?.rationale], '')
    const hasRecommendedAction = Boolean(resolvedRecommendationText && isActionOrientedRecommendation(resolvedRecommendationText) && !isClearlyDuplicativeDisplayText(resolvedRecommendationText, reasoningText))
    const recommendationText = hasRecommendedAction ? resolvedRecommendationText : ''

    const strengths = firstDisplayArray([candidate.strengthsFull, candidate?.displayText?.strengths?.full, candidate?.rawDisplayFields?.strengths, (Array.isArray(candidate.strengths) && candidate.strengths.length ? candidate.strengths : candidate.achievements || [])])
      .map((e)=>normalizeDisplayNarrative(e,'')).filter(Boolean)
    const fitRisks = pickFullerArrayValue(candidate?.risksOrGapsFull, candidate?.displayText?.risksOrGaps?.full, candidate?.rawDisplayFields?.risksOrGaps, candidate?.fit_assessment?.risks_or_gaps)
    const considerationFallbacks = firstDisplayArray([candidate.considerationsFull, candidate?.displayText?.considerations?.full, candidate?.rawDisplayFields?.considerations, candidate.considerations])
    const considerations = mergeUniqueDisplayArrays(fitRisks.length ? fitRisks : considerationFallbacks)

    const matchedSkills = mergeUniqueDisplayArrays(
      pickFullerArrayValue(candidate?.matchedRequirementsFull, candidate?.matchedSkillsFull, candidate?.displayText?.matchedRequirements?.full, candidate?.displayText?.matchedSkills?.full, candidate?.rawDisplayFields?.matchedRequirements, candidate?.rawDisplayFields?.matchedSkills, candidate?.fit_assessment?.matched, candidate?.matchedSkills),
      candidate?.matchedSkills,
    )
    const missingSkills = mergeUniqueDisplayArrays(
      candidate?.mustHaveSkills,
      candidate?.missingSkills,
      pickFullerArrayValue(candidate?.missingRequirementsFull, candidate?.mustHaveSkillsFull, candidate?.missingSkillsFull, candidate?.displayText?.missingRequirements?.full, candidate?.displayText?.missingSkills?.full, candidate?.rawDisplayFields?.missingRequirements, candidate?.rawDisplayFields?.missingSkills, candidate?.fit_assessment?.missing, candidate?.mustHaveSkills, candidate?.missingSkills),
    )
    const allSkills = [...new Set([
      ...(Array.isArray(candidate?.allSkillsFull) ? candidate.allSkillsFull : []),
      ...(Array.isArray(candidate?.displayText?.allSkills?.full) ? candidate.displayText.allSkills.full : []),
      ...(Array.isArray(candidate?.rawDisplayFields?.allSkills) ? candidate.rawDisplayFields.allSkills : []),
      ...(Array.isArray(candidate?.top_skills) ? candidate.top_skills : []),
      ...(Array.isArray(candidate?.skills) ? candidate.skills : []),
      ...(Array.isArray(candidate?.matchedSkills) ? candidate.matchedSkills : []),
      ...(Array.isArray(candidate?.mustHaveSkills) ? candidate.mustHaveSkills : []),
    ].map((e)=>cleanAiTextForDisplay(e,'')).filter(Boolean))]

    const initials = toDisplayText(candidate.name, 'NA').split(' ').map((p)=>p[0]||'').join('').slice(0,2).toUpperCase() || 'NA'
    return {
      isUnavailable: false,
      unavailableMessage: '',
      candidate,
      candidateKey: resolveCandidateKey(candidate),
      candidateName: toDisplayText(candidate.name, 'Candidate'),
      candidateTitle,
      locationLabel,
      seniorityLabel,
      experienceLabel,
      experienceYearsLabel,
      yearsExperienceNumber: yearsNumber,
      initials,
      scoreTier: tier,
      displayScore,
      hasDisplayScore,
      verdictLabel: hasDisplayScore ? (tier==='strong'?'Strong match':tier==='possible'?'Possible match':'Low match') : 'Unable to score',
      confidenceLabel: resolveDrawerConfidenceLabel(candidate, hasDisplayScore),
      summaryText,
      reasoningText,
      hasRecommendedAction,
      recommendationText,
      candidateStrengths: strengths,
      candidateConsiderations: considerations,
      matchedSkills,
      missingSkills,
      allSkills,
      totalSkills: matchedSkills.length + missingSkills.length,
      resumeFileLabel: buildResumeFileIdentity(candidate, 'Resume unavailable').filename,
      email: toDisplayText(candidate.email, ''),
      educationLabel: resolveEducationLabel(candidate.education, 'Education details unavailable'),
    }
  } catch {
    return {
      isUnavailable: true,
      unavailableMessage: 'Candidate details unavailable',
      candidate: sanitizeExpandedCandidate({}),
      candidateKey: 'candidate-detail-unavailable',
      candidateName: 'Candidate',
      candidateTitle: '',
      locationLabel: 'Location unavailable',
      seniorityLabel: '',
      experienceLabel: '0 yrs exp',
      experienceYearsLabel: '0 years',
      yearsExperienceNumber: null,
      initials: 'NA',
      scoreTier: 'unscored',
      displayScore: null,
      hasDisplayScore: false,
      verdictLabel: 'Unable to score',
      confidenceLabel: '',
      summaryText: 'Candidate details unavailable',
      reasoningText: 'Candidate details unavailable',
      hasRecommendedAction: false,
      recommendationText: '',
      candidateStrengths: [],
      candidateConsiderations: [],
      matchedSkills: [],
      missingSkills: [],
      allSkills: [],
      totalSkills: 0,
      resumeFileLabel: 'Resume unavailable',
      email: '',
      educationLabel: 'Education details unavailable',
    }
  }
}
