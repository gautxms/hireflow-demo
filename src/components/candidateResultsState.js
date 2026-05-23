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


function normalizeEducationRecord(record) {
  if (record == null) return null

  if (typeof record === 'string') {
    const text = record.trim()
    return text ? { degree: text, school: '', graduationYear: '', text } : null
  }

  if (typeof record !== 'object' || Array.isArray(record)) return null

  const degree = toDisplayText(record.degree || record.qualification || record.program || record.course, '').trim()
  const school = toDisplayText(record.school || record.institution || record.university || record.college, '').trim()
  const graduationYear = toDisplayText(record.graduation_year || record.graduationYear || record.year, '').trim()
  const fallbackText = toDisplayText(record.text || record.label || record.value || record.name, '').trim()

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
  const matchBreakdown = candidate?.matchScore?.breakdown || candidate?.scoreBreakdown
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
  return value.map((entry) => toDisplayText(entry, '')).filter(Boolean)
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
    strengths: toStringArray(source.strengths),
    achievements: toStringArray(source.achievements),
    considerations: toStringArray(source.considerations),
    mustHaveSkills: toStringArray(source.mustHaveSkills),
    missingSkills: toStringArray(source.missingSkills),
    experience: Array.isArray(source.experience) ? source.experience.map((entry) => toPlainObject(entry)) : [],
    integrity_checks: Array.isArray(source.integrity_checks) ? source.integrity_checks : [],
    fit_assessment: {
      ...fitAssessment,
      matched: toStringArray(fitAssessment.matched),
      missing: toStringArray(fitAssessment.missing),
      reason: toDisplayText(fitAssessment.reason, ''),
      risk: toDisplayText(fitAssessment.risk, ''),
      confidence: toDisplayText(fitAssessment.confidence, ''),
      verdict: toDisplayText(fitAssessment.verdict, ''),
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
        reason: toDisplayText(source?.matchScore?.reason, ''),
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

    const candidateTitle = toDisplayText(candidate?.experience?.[0]?.title || candidate.current_title, '')
    const yearsRaw = Number(candidate.years_experience)
    const yearsNumber = Number.isFinite(yearsRaw) ? yearsRaw : null
    const experienceLabel = yearsNumber != null ? `${yearsNumber} yrs exp` : '0 yrs exp'
    const experienceYearsLabel = yearsNumber != null ? `${yearsNumber} years` : '0 years'
    const locationLabel = toDisplayText(candidate.location, 'Location unavailable')
    const seniorityLabel = toDisplayText(candidate.seniority_level, '')
    const summaryText = toDisplayText(candidate.summary, 'No summary available')
    const reasoningText = toDisplayText(candidate?.matchScore?.reason || candidate?.fit_assessment?.reason, 'Reasoning unavailable for this profile.')
    const recommendationText = toDisplayText(candidate?.recommendation || candidate?.fit_assessment?.rationale, '')

    const strengths = (Array.isArray(candidate.strengths) && candidate.strengths.length ? candidate.strengths : candidate.achievements || []).map((e)=>toDisplayText(e,'')).filter(Boolean).slice(0,3)
    const considerations = (Array.isArray(candidate.considerations) ? candidate.considerations : []).map((e)=>toDisplayText(e,'')).filter(Boolean)

    const matchedSkills = (Array.isArray(candidate?.matchedSkills) ? candidate.matchedSkills : []).map((e)=>toDisplayText(e,'')).filter(Boolean)
    const missingSkills = [...new Set([...(Array.isArray(candidate?.mustHaveSkills)?candidate.mustHaveSkills:[]), ...(Array.isArray(candidate?.missingSkills)?candidate.missingSkills:[]), ...(Array.isArray(candidate?.fit_assessment?.missing)?candidate.fit_assessment.missing:[])].map((e)=>toDisplayText(e,'')).filter(Boolean))]
    const allSkills = [...new Set([
      ...(Array.isArray(candidate?.top_skills) ? candidate.top_skills : []),
      ...(Array.isArray(candidate?.skills) ? candidate.skills : []),
      ...(Array.isArray(candidate?.matchedSkills) ? candidate.matchedSkills : []),
      ...(Array.isArray(candidate?.mustHaveSkills) ? candidate.mustHaveSkills : []),
    ].map((e)=>toDisplayText(e,'')).filter(Boolean))]

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
      recommendationText,
      candidateStrengths: strengths,
      candidateConsiderations: considerations,
      matchedSkills,
      missingSkills,
      allSkills,
      totalSkills: matchedSkills.length + missingSkills.length,
      resumeFileLabel: toDisplayText(candidate.filename || candidate.resume_filename, 'Resume unavailable'),
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
