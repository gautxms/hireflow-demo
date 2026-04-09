import crypto from 'crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { pool } from '../db/client.js'

const router = Router()
const SHARE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000
const shareTokenStore = new Map()

function parseExperienceToYears(experience) {
  if (!experience) {
    return 0
  }

  if (Array.isArray(experience)) {
    return experience.reduce((total, entry) => {
      const duration = entry?.duration || ''
      const match = String(duration).match(/(\d+(?:\.\d+)?)/)
      return total + (match ? Number(match[1]) : 0)
    }, 0)
  }

  const match = String(experience).match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function parseUploadedAt(candidate = {}) {
  const timestamp = Date.parse(String(candidate.uploadDate || candidate.uploadedAt || candidate.created_at || candidate.createdAt || ''))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function parseSkills(skills) {
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
  const years = parseExperienceToYears(candidate.experience)

  if (years >= 8) return 4
  if (years >= 5) return 3
  if (years >= 2) return 2
  return 1
}

export function getExperienceLevel(candidate) {
  const years = parseExperienceToYears(candidate.experience)

  if (years >= 8) return 'lead'
  if (years >= 5) return 'senior'
  if (years >= 2) return 'mid'
  return 'junior'
}

export function normalizeCandidate(candidate = {}) {
  const experienceValue = Array.isArray(candidate.experience)
    ? candidate.experience.map((entry) => entry?.duration).filter(Boolean).join(' | ')
    : candidate.experience
  const educationValue = Array.isArray(candidate.education)
    ? candidate.education.map((entry) => `${entry?.degree || ''}${entry?.school ? `, ${entry.school}` : ''}`.trim()).filter(Boolean).join(' | ')
    : candidate.education

  return {
    id: candidate.id || crypto.randomUUID(),
    name: candidate.name || 'Unknown Candidate',
    email: candidate.email || '',
    phone: candidate.phone || '',
    score: Number(candidate.score || 0),
    summary: candidate.summary || '',
    skills: parseSkills(candidate.skills),
    strengths: Array.isArray(candidate.pros) ? candidate.pros : Array.isArray(candidate.strengths) ? candidate.strengths : [],
    cons: Array.isArray(candidate.cons) ? candidate.cons : [],
    location: candidate.location || 'Unknown',
    experience: experienceValue || '0 years',
    position: candidate.position || '',
    education: educationValue || '',
    fit: candidate.fit || '',
    tier: candidate.tier || 'consider',
    certifications: Array.isArray(candidate.certifications) ? candidate.certifications : [],
    languages: Array.isArray(candidate.languages) ? candidate.languages : [],
    projects: Array.isArray(candidate.projects) ? candidate.projects : [],
    githubProfile: candidate.githubProfile || '',
    linkedinProfile: candidate.linkedinProfile || '',
    achievements: Array.isArray(candidate.achievements) ? candidate.achievements : [],
    confidenceScores: candidate.confidenceScores && typeof candidate.confidenceScores === 'object' ? candidate.confidenceScores : {},
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

    if (effectiveMinScore !== undefined && effectiveMinScore !== null && effectiveMinScore !== '' && candidate.score < Number(effectiveMinScore)) {
      return false
    }

    if (effectiveMaxScore !== undefined && effectiveMaxScore !== null && effectiveMaxScore !== '' && candidate.score > Number(effectiveMaxScore)) {
      return false
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
      const hasRequestedSkills = requestedSkills.every((skill) => candidateSkills.includes(skill))
      if (!hasRequestedSkills) {
        return false
      }
    }

    const years = parseExperienceToYears(candidate.experience)

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

    if (normalizedSortBy === 'seniority' || normalizedSortBy === 'experience') {
      return getSeniorityRank(a) - getSeniorityRank(b)
    }

    if (normalizedSortBy === 'upload_date' || normalizedSortBy === 'uploadDate') {
      return parseUploadedAt(a) - parseUploadedAt(b)
    }

    return a.score - b.score
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
    const safePage = Math.max(1, Number(page))

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
    const sorted = sortCandidates(filtered, sortBy, sortOrder)

    const total = sorted.length
    const totalPages = Math.max(1, Math.ceil(total / safePageSize))
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
      sort: { sortBy, sortOrder },
      filters: {
        scoreMin: scoreMin ?? null,
        scoreMax: scoreMax ?? null,
        location: location ?? null,
        level: level ?? null,
        search: search ?? null,
        skills: skills ?? null,
        experienceMin: experienceMin ?? null,
        experienceMax: experienceMax ?? null,
        matchMin: matchMin ?? null,
        matchMax: matchMax ?? null,
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

    const shareToken = crypto.randomBytes(24).toString('base64url')
    const createdAt = Date.now()
    const expiresAt = createdAt + SHARE_LINK_TTL_MS

    shareTokenStore.set(shareToken, {
      candidates,
      createdAt,
      expiresAt,
      ownerUserId: req.userId,
    })

    return res.status(201).json({
      shareToken,
      sharePath: `/results/${shareToken}`,
      expiresAt,
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
  })
})

export default router
