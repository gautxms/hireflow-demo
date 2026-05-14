import crypto from 'crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { pool } from '../db/client.js'
import { resolveCanonicalCandidateIdentity } from '../utils/candidateIdentity.js'
import { normalizeCandidateExperience } from '../utils/experienceNormalization.js'

const router = Router()
const SHARE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000
const shareTokenStore = new Map()

const ALLOWED_SORT_BY = new Set(['score', 'match_score', 'name', 'location', 'seniority', 'experience', 'upload_date', 'uploadDate'])
const ALLOWED_SORT_ORDER = new Set(['asc', 'desc'])


const FAILED_RESUME_PROCESSING_STATUSES = new Set(['extraction_failed', 'parse_failed', 'scoring_failed'])

function normalizeResumeProcessingStatus(candidate = {}) {
  const rawStatus = candidate?.resumeProcessingStatus ?? candidate?.resume_processing_status ?? candidate?.status
  const normalizedStatus = String(rawStatus || '').trim().toLowerCase()
  return normalizedStatus || null
}

function hasRankableScore(candidate = {}) {
  return Number.isFinite(candidate?.score)
}

function isNonRankableCandidate(candidate = {}) {
  return FAILED_RESUME_PROCESSING_STATUSES.has(String(candidate?.resumeProcessingStatus || '').toLowerCase()) || !hasRankableScore(candidate)
}

function sanitizeSortBy(value) {
  const normalized = String(value || 'score')
  return ALLOWED_SORT_BY.has(normalized) ? normalized : 'score'
}

function sanitizeSortOrder(value, sortBy) {
  if (sortBy === 'name') {
    return 'asc'
  }

  const normalized = String(value || 'desc').toLowerCase()
  return ALLOWED_SORT_ORDER.has(normalized) ? normalized : 'desc'
}

function sanitizeQueryValue(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  return String(value)
}

function resolveExperienceYears(candidate = {}) {
  const normalized = normalizeCandidateExperience(candidate)
  if (normalized.totalExperienceYears !== null) return normalized.totalExperienceYears
  if (normalized.relevantExperienceYears !== null) return normalized.relevantExperienceYears
  return null
}

function normalizeExperienceContract(candidate = {}) {
  return normalizeCandidateExperience(candidate)
}
function parseUploadedAt(candidate = {}) {
  const timestamp = Date.parse(String(candidate.uploadDate || candidate.uploadedAt || candidate.created_at || candidate.createdAt || ''))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function parseSkills(skills) {
  if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
    return [
      ...(Array.isArray(skills.tools_and_platforms) ? skills.tools_and_platforms : []),
      ...(Array.isArray(skills.methodologies) ? skills.methodologies : []),
      ...(Array.isArray(skills.domain_expertise) ? skills.domain_expertise : []),
      ...(Array.isArray(skills.soft_skills) ? skills.soft_skills : []),
    ]
      .map((skill) => String(skill || '').trim())
      .filter(Boolean)
  }

  if (Array.isArray(skills)) {
    return skills
      .map((skill) => String(skill || '').trim())
      .filter(Boolean)
  }

  return String(skills || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)
}

function normalizeText(value, fallback = '') {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function normalizeEducationEntry(entry) {
  if (typeof entry === 'string') {
    const rawText = normalizeText(entry, '')
    return rawText ? { degree: null, field: null, institution: null, startDate: null, endDate: null, grade: null, gradeType: null, rawText } : null
  }
  if (!entry || typeof entry !== 'object') return null
  const normalized = {
    degree: normalizeText(entry.degree || entry.qualification || entry.program, ''),
    field: normalizeText(entry.field || entry.major || entry.specialization, ''),
    institution: normalizeText(entry.institution || entry.school || entry.university, ''),
    startDate: normalizeText(entry.startDate || entry.start_date || entry.from, ''),
    endDate: normalizeText(entry.endDate || entry.end_date || entry.to, ''),
    grade: normalizeText(entry.grade || entry.gpa || entry.score, ''),
    gradeType: normalizeText(entry.gradeType || entry.grade_type, ''),
    rawText: normalizeText(entry.rawText || entry.text || entry.value, ''),
  }
  return Object.values(normalized).some(Boolean) ? normalized : null
}

function normalizeEducation(educationValue, candidate = {}) {
  const raw = educationValue ?? candidate?.highestEducation ?? candidate?.highest_education ?? candidate?.degree ?? null
  const canonical = (Array.isArray(raw) ? raw : [raw]).map((entry) => normalizeEducationEntry(entry)).filter(Boolean)
  const legacyEducation = typeof raw === 'string'
    ? normalizeText(raw, '')
    : canonical.map((entry) => [entry.degree, entry.institution].filter(Boolean).join(', ')).filter(Boolean).join(' | ')
  const highestEducation = normalizeText(candidate?.highestEducation || candidate?.highest_education, '') || canonical[0]?.degree || ''
  const degree = normalizeText(candidate?.degree, '') || canonical[0]?.degree || ''
  return { canonical, legacyEducation, highestEducation, degree }
}

function sentenceSafeClamp(value, maxLength = 240) {
  const normalized = normalizeText(value)
  if (!normalized || normalized.length <= maxLength) {
    return normalized
  }
  const sliced = normalized.slice(0, maxLength)
  const sentenceBreak = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('! '), sliced.lastIndexOf('? '))
  if (sentenceBreak >= 40) {
    return sliced.slice(0, sentenceBreak + 1).trim()
  }
  const wordBreak = sliced.lastIndexOf(' ')
  return `${(wordBreak >= 40 ? sliced.slice(0, wordBreak) : sliced).trim()}…`
}

function normalizeIntegritySeverity(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : 'low'
}

function normalizeResumeIntegrityFlags(candidate = {}) {
  const raw = Array.isArray(candidate?.resumeIntegrityFlags) ? candidate.resumeIntegrityFlags : []
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object') return null
    return {
      issueType: normalizeText(entry.issueType || entry.issue_type, 'general_parsing_concern'),
      severity: normalizeIntegritySeverity(entry.severity),
      label: sentenceSafeClamp(entry.label || 'Potential issue', 120),
      evidence: sentenceSafeClamp(entry.evidence || 'Needs recruiter review', 240),
      recruiterAction: sentenceSafeClamp(entry.recruiterAction || entry.recruiter_action || 'Needs recruiter review', 180),
      confidence: Math.max(0, Math.min(1, Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence) : 0.5)),
      source: normalizeText(entry.source || 'ai_assisted', 'ai_assisted'),
    }
  }).filter(Boolean).slice(0, 8)
}

function normalizeEvidenceItems(candidate = {}) {
  const rawEvidence = Array.isArray(candidate.evidence)
    ? candidate.evidence
    : Array.isArray(candidate.evidenceSnippets)
      ? candidate.evidenceSnippets
      : []

  return rawEvidence
    .map((entry) => {
      if (typeof entry === 'string') {
        const normalizedExperience = normalizeExperienceContract(candidate)

  return {
          quote: sentenceSafeClamp(entry, 240),
          section: '',
          span: '',
          source: 'resume_text',
        }
      }

      if (!entry || typeof entry !== 'object') return null

      const quote = sentenceSafeClamp(entry.quote || entry.snippet || entry.text || '', 240)
      const section = normalizeText(entry.section || entry.resumeSection || '')
      const span = normalizeText(entry.span || entry.resumeSpan || '')
      return {
        quote,
        section,
        span,
        source: normalizeText(entry.source || 'resume_text'),
      }
    })
    .filter((entry) => entry && entry.quote)
}

function parseSkillsFilter(rawSkills) {
  if (Array.isArray(rawSkills)) {
    return rawSkills
      .flatMap((skillSet) => String(skillSet || '').split(','))
      .map((skill) => skill.trim())
      .filter(Boolean)
  }

  return String(rawSkills || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)
}

export function getSeniorityRank(candidate) {
  const years = resolveExperienceYears(candidate)

  if (years >= 8) return 4
  if (years >= 5) return 3
  if (years >= 2) return 2
  return 1
}

export function getExperienceLevel(candidate) {
  const years = resolveExperienceYears(candidate)

  if (years >= 8) return 'lead'
  if (years >= 5) return 'senior'
  if (years >= 2) return 'mid'
  return 'junior'
}

export function normalizeCandidate(candidate = {}) {
  const { id, candidateId, resumeId } = resolveCanonicalCandidateIdentity(candidate)
  const experienceValue = Array.isArray(candidate.experience)
    ? candidate.experience.map((entry) => entry?.duration).filter(Boolean).join(' | ')
    : candidate.experience
  const normalizedEducation = normalizeEducation(candidate.education, candidate)

  const normalizedSkillsObject = candidate.skills_structured && typeof candidate.skills_structured === 'object'
    ? candidate.skills_structured
    : (candidate.skills && typeof candidate.skills === 'object' && !Array.isArray(candidate.skills)
      ? candidate.skills
      : {
          tools_and_platforms: Array.isArray(candidate.skills) ? candidate.skills : parseSkills(candidate.skills),
          methodologies: [],
          domain_expertise: [],
          soft_skills: [],
        })

  const rawScore = candidate?.matchScore && typeof candidate.matchScore === 'object'
    ? (candidate?.matchScore?.score ?? candidate?.score)
    : (candidate?.matchScore ?? candidate?.score)
  const numericScore = Number(rawScore)
  const safeScore = Number.isFinite(numericScore) ? Math.max(0, Math.min(100, numericScore)) : null
  const resumeProcessingStatus = normalizeResumeProcessingStatus(candidate)
  const isFailedProcessingStatus = FAILED_RESUME_PROCESSING_STATUSES.has(String(resumeProcessingStatus || '').toLowerCase())
  const isRankable = !isFailedProcessingStatus && safeScore !== null
  const reasoningFallback = sentenceSafeClamp(
    candidate?.fit_assessment?.reason
    || candidate?.recommendation
    || candidate?.summary
    || 'Candidate scored using role fit, skills alignment, and experience depth.',
  )
  const fitAssessment = candidate?.fit_assessment && typeof candidate.fit_assessment === 'object'
    ? candidate.fit_assessment
    : {}
  const matchedRequirements = Array.isArray(candidate?.matchedRequirements)
    ? candidate.matchedRequirements
    : Array.isArray(fitAssessment?.matched)
      ? fitAssessment.matched
      : Array.isArray(fitAssessment?.matched_requirements)
        ? fitAssessment.matched_requirements
        : []
  const missingRequirements = Array.isArray(candidate?.missingRequirements)
    ? candidate.missingRequirements
    : Array.isArray(fitAssessment?.missing)
      ? fitAssessment.missing
      : Array.isArray(fitAssessment?.missing_requirements)
        ? fitAssessment.missing_requirements
        : []
  const evidence = normalizeEvidenceItems(candidate)
  const uncertaintyNotes = Array.isArray(candidate?.uncertaintyNotes)
    ? candidate.uncertaintyNotes
    : [fitAssessment?.uncertainty || candidate?.uncertainty || ''].filter(Boolean)
  const structuredExperience = Array.isArray(candidate?.experience)
    ? candidate.experience
    : (normalizeText(candidate?.experience) ? [{ title: normalizeText(candidate.experience) }] : [])
  const normalizedExperience = normalizeExperienceContract(candidate)
  const resumeIntegrityFlags = normalizeResumeIntegrityFlags(candidate)
  const has = (key) => Object.prototype.hasOwnProperty.call(candidate, key)

  return {
    id,
    candidateId,
    resumeId,
    name: candidate.name || 'Unknown Candidate',
    email: candidate.email || '',
    phone: candidate.phone || '',
    score: isRankable ? safeScore : null,
    matchScore: {
      score: isRankable ? safeScore : null,
      reason: sentenceSafeClamp(candidate?.matchScore?.reason || reasoningFallback),
    },
    summary: sentenceSafeClamp(candidate.summary || 'Summary not provided in this analysis.', 320),
    skills: normalizedSkillsObject,
    skills_flat: has('skills_flat') ? candidate.skills_flat : (Array.isArray(candidate.skills_flat) ? candidate.skills_flat : parseSkills(candidate.skills)),
    skills_structured: has('skills_structured') ? candidate.skills_structured : normalizedSkillsObject,
    ...(has('allExtractedSkills') ? { allExtractedSkills: candidate.allExtractedSkills } : {}),
    top_skills: Array.isArray(candidate.top_skills) && candidate.top_skills.length > 0 ? candidate.top_skills : parseSkills(candidate.skills).slice(0, 5),
    strengths: Array.isArray(candidate.pros) ? candidate.pros : Array.isArray(candidate.strengths) ? candidate.strengths : [reasoningFallback],
    considerations: Array.isArray(candidate.considerations) && candidate.considerations.length > 0 ? candidate.considerations : [fitAssessment.risk || 'Validate role-specific depth during interview.'],
    cons: Array.isArray(candidate.cons) ? candidate.cons : [],
    profile_score: Number.isFinite(Number(candidate.profile_score)) ? Number(candidate.profile_score) : null,
    years_experience: Number.isFinite(Number(candidate.years_experience)) ? Number(candidate.years_experience) : null,
    ...normalizedExperience,
    seniority_level: candidate.seniority_level || null,
    tags: Array.isArray(candidate.tags) ? candidate.tags : [],
    location: candidate.location || 'Unknown',
    experience: structuredExperience.length > 0 ? structuredExperience : (experienceValue || '0 years'),
    experience_years: Number.isFinite(Number(candidate.experience_years))
      ? Number(candidate.experience_years)
      : resolveExperienceYears({ ...candidate, experience: experienceValue || candidate.experience }),
    position: candidate.position || '',
    education: has('education') ? candidate.education : normalizedEducation.canonical,
    legacyEducation: normalizedEducation.legacyEducation || '',
    highestEducation: normalizedEducation.highestEducation || '',
    highest_education: normalizedEducation.highestEducation || '',
    degree: normalizedEducation.degree || '',
    fit: candidate.fit || '',
    fit_assessment: {
      matched: matchedRequirements,
      missing: missingRequirements,
      risk: normalizeText(fitAssessment.risk || fitAssessment.risks || ''),
      uncertainty: normalizeText(fitAssessment.uncertainty || ''),
      reason: sentenceSafeClamp(fitAssessment.reason || candidate?.matchScore?.reason || reasoningFallback),
    },
    matchedRequirements,
    missingRequirements,
    evidence,
    uncertaintyNotes,
    suggestedRecruiterAction: sentenceSafeClamp(candidate?.suggestedRecruiterAction || fitAssessment?.risk || 'Schedule targeted interview follow-up for validation.'),
    resumeFilename: normalizeText(candidate?.resumeFilename || candidate?.filename || ''),
    resumeAssetRef: normalizeText(candidate?.resumeAssetRef || candidate?.resumeId || candidate?.resume_id || ''),
    resumeProcessingStatus,
    parseMeta: candidate?.parseMeta && typeof candidate.parseMeta === 'object'
      ? { ...candidate.parseMeta }
      : {},
    tier: candidate.tier || 'consider',
    certifications: Array.isArray(candidate.certifications) ? candidate.certifications : [],
    languages: Array.isArray(candidate.languages) ? candidate.languages : [],
    projects: Array.isArray(candidate.projects) ? candidate.projects : [],
    githubProfile: candidate.githubProfile || '',
    linkedinProfile: candidate.linkedinProfile || '',
    achievements: Array.isArray(candidate.achievements) ? candidate.achievements : [],
    confidenceScores: candidate.confidenceScores && typeof candidate.confidenceScores === 'object' ? candidate.confidenceScores : {},
    ...(has('totalExperienceYears') ? { totalExperienceYears: candidate.totalExperienceYears } : {}),
    ...(has('relevantExperienceYears') ? { relevantExperienceYears: candidate.relevantExperienceYears } : {}),
    ...(has('experienceLabel') ? { experienceLabel: candidate.experienceLabel } : {}),
    ...(has('experienceSource') ? { experienceSource: candidate.experienceSource } : {}),
    ...(has('isExperienceEstimated') ? { isExperienceEstimated: candidate.isExperienceEstimated } : {}),
    ...(has('experienceExplanation') ? { experienceExplanation: candidate.experienceExplanation } : {}),
    ...(resumeIntegrityFlags.length > 0 ? { resumeIntegrityFlags } : {}),
  }
}

export function applyCandidateFilters(candidates, {
  scoreMin,
  scoreMax,
  location,
  level,
  search,
  skills,
  experienceMin,
  experienceMax,
  matchMin,
  matchMax,
}) {
  const requestedSkills = parseSkillsFilter(skills).map((skill) => skill.toLowerCase())
  const normalizedSearch = String(search || '').trim().toLowerCase()

  return candidates.filter((candidate) => {
    const effectiveMinScore = matchMin ?? scoreMin
    const effectiveMaxScore = matchMax ?? scoreMax

    const hasScore = hasRankableScore(candidate)

    if (effectiveMinScore !== undefined && effectiveMinScore !== null && effectiveMinScore !== '') {
      if (!hasScore || candidate.score < Number(effectiveMinScore)) {
        return false
      }
    }

    if (effectiveMaxScore !== undefined && effectiveMaxScore !== null && effectiveMaxScore !== '') {
      if (!hasScore || candidate.score > Number(effectiveMaxScore)) {
        return false
      }
    }

    if (location && location !== 'all' && candidate.location.toLowerCase() !== String(location).toLowerCase()) {
      return false
    }

    if (level && level !== 'all' && getExperienceLevel(candidate) !== level) {
      return false
    }

    if (normalizedSearch) {
      const searchable = `${candidate.name || ''} ${candidate.email || ''} ${candidate.phone || ''}`.toLowerCase()
      if (!searchable.includes(normalizedSearch)) {
        return false
      }
    }

    if (requestedSkills.length > 0) {
      const candidateSkills = parseSkills(candidate.skills).map((skill) => skill.toLowerCase())
      const hasRequestedSkills = requestedSkills.some((skill) => candidateSkills.includes(skill))
      if (!hasRequestedSkills) {
        return false
      }
    }

    const years = resolveExperienceYears(candidate) ?? 0

    if (experienceMin !== undefined && experienceMin !== null && experienceMin !== '' && years < Number(experienceMin)) {
      return false
    }

    if (experienceMax !== undefined && experienceMax !== null && experienceMax !== '' && years > Number(experienceMax)) {
      return false
    }

    return true
  })
}

export function sortCandidates(candidates, sortBy = 'score', sortOrder = 'desc') {
  const normalizedSortBy = sortBy === 'match_score' ? 'score' : sortBy
  const normalizedSortOrder = normalizedSortBy === 'name' ? 'asc' : sortOrder
  const sorted = [...candidates]

  sorted.sort((a, b) => {
    if (normalizedSortBy === 'name') {
      return a.name.localeCompare(b.name)
    }

    if (normalizedSortBy === 'location') {
      return a.location.localeCompare(b.location)
    }

    if (normalizedSortBy === 'seniority') {
      return getSeniorityRank(a) - getSeniorityRank(b)
    }

    if (normalizedSortBy === 'experience') {
      const aExp = normalizeCandidateExperience(a)
      const bExp = normalizeCandidateExperience(b)
      const aPrimary = aExp.totalExperienceYears
      const bPrimary = bExp.totalExperienceYears
      const aFallback = aExp.relevantExperienceYears
      const bFallback = bExp.relevantExperienceYears
      const aKnown = aPrimary !== null || aFallback !== null
      const bKnown = bPrimary !== null || bFallback !== null
      if (aKnown !== bKnown) return aKnown ? 1 : -1
      const aValue = aPrimary ?? aFallback ?? -1
      const bValue = bPrimary ?? bFallback ?? -1
      if (aValue !== bValue) return aValue - bValue
      const aScore = hasRankableScore(a) ? a.score : -1
      const bScore = hasRankableScore(b) ? b.score : -1
      if (aScore !== bScore) return aScore - bScore
      return b.name.localeCompare(a.name)
    }

    if (normalizedSortBy === 'upload_date' || normalizedSortBy === 'uploadDate') {
      return parseUploadedAt(a) - parseUploadedAt(b)
    }

    const aNonRankable = isNonRankableCandidate(a)
    const bNonRankable = isNonRankableCandidate(b)
    if (aNonRankable !== bNonRankable) return aNonRankable ? -1 : 1
    const aScore = hasRankableScore(a) ? a.score : -1
    const bScore = hasRankableScore(b) ? b.score : -1
    return aScore - bScore
  })

  if (normalizedSortOrder === 'desc') {
    sorted.reverse()
  }

  return sorted
}

async function getLatestCandidatesForUser(userId) {
  const result = await pool.query(
    `SELECT result
     FROM parse_jobs
     WHERE user_id = $1
       AND status = 'complete'
       AND result IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId],
  )

  const latestResult = result.rows[0]?.result
  const rawCandidates = Array.isArray(latestResult?.candidates) ? latestResult.candidates : []
  return rawCandidates.map(normalizeCandidate)
}

function cleanupExpiredShareTokens() {
  const now = Date.now()

  for (const [token, payload] of shareTokenStore.entries()) {
    if (payload.expiresAt <= now) {
      shareTokenStore.delete(token)
    }
  }
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 25,
      sortBy = 'score',
      sortOrder = 'desc',
      scoreMin,
      scoreMax,
      location,
      level,
      search,
      skills,
      experienceMin,
      experienceMax,
      matchMin,
      matchMax,
    } = req.query

    const safePageSize = Math.min(100, Math.max(1, Number(pageSize)))
    const requestedPage = Math.max(1, Number(page))
    const safeSortBy = sanitizeSortBy(sortBy)
    const safeSortOrder = sanitizeSortOrder(sortOrder, safeSortBy)

    const candidates = await getLatestCandidatesForUser(req.userId)
    const filtered = applyCandidateFilters(candidates, {
      scoreMin,
      scoreMax,
      location,
      level,
      search,
      skills,
      experienceMin,
      experienceMax,
      matchMin,
      matchMax,
    })
    const sorted = sortCandidates(filtered, safeSortBy, safeSortOrder)

    const total = sorted.length
    const totalPages = Math.max(1, Math.ceil(total / safePageSize))
    const safePage = Math.min(requestedPage, totalPages)
    const offset = (safePage - 1) * safePageSize
    const rows = sorted.slice(offset, offset + safePageSize)

    return res.json({
      candidates: rows,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages,
        hasNextPage: safePage < totalPages,
      },
      sort: { sortBy: safeSortBy, sortOrder: safeSortOrder },
      filters: {
        scoreMin: sanitizeQueryValue(scoreMin),
        scoreMax: sanitizeQueryValue(scoreMax),
        location: sanitizeQueryValue(location),
        level: sanitizeQueryValue(level),
        search: sanitizeQueryValue(search),
        skills: sanitizeQueryValue(skills),
        experienceMin: sanitizeQueryValue(experienceMin),
        experienceMax: sanitizeQueryValue(experienceMax),
        matchMin: sanitizeQueryValue(matchMin),
        matchMax: sanitizeQueryValue(matchMax),
      },
    })
  } catch (error) {
    console.error('[Results] Failed to fetch results:', error)
    return res.status(500).json({ error: 'Unable to fetch candidate results' })
  }
})

router.post('/share', requireAuth, async (req, res) => {
  try {
    cleanupExpiredShareTokens()

    const incoming = Array.isArray(req.body?.candidates) ? req.body.candidates : null
    const candidates = (incoming ? incoming : await getLatestCandidatesForUser(req.userId)).map(normalizeCandidate)

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'No candidates available to share' })
    }

    const query = req.body?.query && typeof req.body.query === 'object' ? req.body.query : {}

    const shareToken = crypto.randomBytes(24).toString('base64url')
    const createdAt = Date.now()
    const expiresAt = createdAt + SHARE_LINK_TTL_MS

    shareTokenStore.set(shareToken, {
      candidates,
      createdAt,
      expiresAt,
      ownerUserId: req.userId,
      query,
    })

    return res.status(201).json({
      shareToken,
      sharePath: `/results/${shareToken}`,
      expiresAt,
      query,
    })
  } catch (error) {
    console.error('[Results] Failed to create share link:', error)
    return res.status(500).json({ error: 'Unable to create share link' })
  }
})

router.get('/shared/:shareToken', async (req, res) => {
  cleanupExpiredShareTokens()

  const payload = shareTokenStore.get(req.params.shareToken)

  if (!payload) {
    return res.status(404).json({ error: 'Share link not found or expired' })
  }

  if (payload.expiresAt <= Date.now()) {
    shareTokenStore.delete(req.params.shareToken)
    return res.status(410).json({ error: 'Share link expired' })
  }

  return res.json({
    candidates: payload.candidates,
    readOnly: true,
    expiresAt: payload.expiresAt,
    query: payload.query || {},
  })
})

export default router
