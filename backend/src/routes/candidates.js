import { Router } from 'express'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Buffer } from 'node:buffer'
import { requireAuth } from '../middleware/authMiddleware.js'
import { matchCandidatesToJob } from '../services/matchingService.js'
import { pool } from '../db/client.js'
import { normalizeTags } from './candidateTagsState.js'
import { analyzeResumeWithConfiguredFallback, canonicalizeAnalysisScoreFields } from '../services/aiResumeAnalysisService.js'
import { applyJobDescriptionScoringMode } from '../jobs/parseResumeJob.js'
import { syncCandidateProfilesForUser } from '../services/candidateProfilesService.js'
import { resolveCandidateResumeUuid, resolveCanonicalCandidateIdentity } from '../utils/candidateIdentity.js'
import { normalizeCandidateDirectoryQuery } from '../../../src/schemas/candidateDirectoryQuerySchema.js'
import { getDisplayFilename } from '../utils/resumeFileMetadata.js'

const router = Router()

const s3Bucket = process.env.AWS_S3_BUCKET
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
})

export function closeCandidateRouteResourcesForTests() {
  s3Client.destroy()
}

async function streamToBuffer(streamOrBuffer) {
  if (Buffer.isBuffer(streamOrBuffer)) return streamOrBuffer
  return new Promise((resolve, reject) => {
    const chunks = []
    streamOrBuffer.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    streamOrBuffer.on('end', () => resolve(Buffer.concat(chunks)))
    streamOrBuffer.on('error', reject)
  })
}


function normalizeString(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => normalizeString(entry)).filter(Boolean)
}

function normalizeStructuredSkills(skills) {
  if (Array.isArray(skills) || typeof skills === 'string') {
    return {
      tools_and_platforms: normalizeStringArray(Array.isArray(skills) ? skills : String(skills).split(',')),
      methodologies: [],
      domain_expertise: [],
      soft_skills: [],
    }
  }

  if (!skills || typeof skills !== 'object') {
    return {
      tools_and_platforms: [],
      methodologies: [],
      domain_expertise: [],
      soft_skills: [],
    }
  }

  return {
    tools_and_platforms: normalizeStringArray(skills.tools_and_platforms),
    methodologies: normalizeStringArray(skills.methodologies),
    domain_expertise: normalizeStringArray(skills.domain_expertise),
    soft_skills: normalizeStringArray(skills.soft_skills),
  }
}

function flattenStructuredSkills(skillsStructured) {
  const flattened = [
    ...(skillsStructured.tools_and_platforms || []),
    ...(skillsStructured.methodologies || []),
    ...(skillsStructured.domain_expertise || []),
    ...(skillsStructured.soft_skills || []),
  ]

  return [...new Set(flattened.map((entry) => normalizeString(entry)).filter(Boolean))]
}

function parseStringList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => String(entry || '').split(',')).map((entry) => entry.trim()).filter(Boolean)
  }

  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

function normalizeNumberFilter(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}


function isCandidateDirectorySyncOnReadEnabled() {
  return String(process.env.CANDIDATE_DIRECTORY_SYNC_ON_READ || '').trim().toLowerCase() === 'true'
}

function countAppliedFilters(filters) {
  return Object.values(filters).filter((value) => {
    if (Array.isArray(value)) return value.length > 0
    return value !== null && value !== undefined && value !== ''
  }).length
}

const sortComparators = {
  name: (entry) => String(entry.name || '').toLowerCase(),
  profileScore: (entry) => entry.profileScore ?? Number.NEGATIVE_INFINITY,
  yearsExperience: (entry) => entry.yearsExperience ?? Number.NEGATIVE_INFINITY,
  sourceUpdatedAt: (entry) => new Date(entry.sourceUpdatedAt || 0).getTime(),
}

export function normalizeResumeTagLookupInput(inputResumeIds) {
  if (!Array.isArray(inputResumeIds)) return null
  return [...new Set(inputResumeIds.map((value) => resolveCandidateResumeUuid(value)).filter(Boolean))]
}

export { isCandidateDirectorySyncOnReadEnabled }

export function buildDirectoryResponse(profiles, filtersApplied, query = {}) {
  const normalizedQuery = normalizeCandidateDirectoryQuery(query)
  const totalCount = profiles.length
  const page = normalizedQuery.page
  const pageSize = normalizedQuery.pageSize
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const clampedPage = Math.min(page, totalPages)
  const sortBy = normalizedQuery.sortBy
  const sortDirection = normalizedQuery.sortDirection
  const sortedProfiles = [...profiles].sort((a, b) => {
    const aValue = sortComparators[sortBy](a)
    const bValue = sortComparators[sortBy](b)
    if (aValue === bValue) return 0
    const cmp = aValue > bValue ? 1 : -1
    return sortDirection === 'asc' ? cmp : -cmp
  })
  const startIndex = (clampedPage - 1) * pageSize
  const paginatedCandidates = sortedProfiles.slice(startIndex, startIndex + pageSize)

  return {
    candidates: paginatedCandidates,
    total: totalCount,
    totalCount,
    page: clampedPage,
    pageSize,
    totalPages,
    sortBy,
    sortDirection,
    filtersApplied,
  }
}

function normalizeCandidateFromAnalysis(candidate, resumeId, fallbackName = 'resume') {
  const skillsStructured = normalizeStructuredSkills(candidate?.skills)
  const skillsFlat = flattenStructuredSkills(skillsStructured)
  const identity = resolveCanonicalCandidateIdentity(
    candidate,
    `${String(resumeId || fallbackName).toLowerCase()}-1`,
  )

  return {
    id: identity.id,
    candidateId: identity.candidateId,
    resumeId: identity.resumeId || String(resumeId || ''),
    ...candidate,
    years_experience: normalizeNullableNumber(candidate?.years_experience),
    profile_score: normalizeNullableNumber(candidate?.profile_score),
    strengths: normalizeStringArray(candidate?.strengths),
    considerations: normalizeStringArray(candidate?.considerations),
    seniority_level: normalizeString(candidate?.seniority_level),
    tags: normalizeStringArray(candidate?.tags),
    top_skills: normalizeStringArray(candidate?.top_skills).slice(0, 5),
    skills_structured: skillsStructured,
    skills: skillsStructured,
    skills_flat: skillsFlat,
    confidenceScores: candidate?.confidenceScores || candidate?.confidence || {},
  }
}

function resolveResumeTextForReanalysis(row) {
  const directRawText = normalizeString(row?.raw_text)
  if (directRawText) {
    return directRawText
  }

  const parseResult = row?.parse_result && typeof row.parse_result === 'object' ? row.parse_result : {}
  const parseResultText = normalizeString(
    parseResult.raw_text
      || parseResult.rawText
      || parseResult.extracted_text
      || parseResult.extractedText
      || parseResult.parsed_text
      || parseResult.parsedText,
  )
  if (parseResultText) {
    return parseResultText
  }

  const previousCandidates = Array.isArray(parseResult.candidates) ? parseResult.candidates : []
  const normalizedTextBlocks = previousCandidates
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return null
      const lines = [
        normalizeString(candidate.name),
        normalizeString(candidate.summary),
        normalizeString(candidate.position),
        normalizeString(candidate.experience),
        normalizeString(Array.isArray(candidate.skills_flat) ? candidate.skills_flat.join(', ') : candidate.skills),
      ].filter(Boolean)
      return lines.length > 0 ? lines.join('\n') : null
    })
    .filter(Boolean)

  return normalizedTextBlocks.length > 0 ? normalizedTextBlocks.join('\n\n') : null
}

router.post('/reanalyse', requireAuth, async (req, res) => {
  const jobDescription = String(req.body?.jobDescription || '').trim()
  if (!jobDescription) {
    return res.status(400).json({ error: 'jobDescription is required' })
  }

  const jobDescriptionContext = {
    hasContext: true,
    source: 'manual_text',
    title: null,
    description: jobDescription,
    requirements: jobDescription,
    skills: [],
    fileText: jobDescription,
    fileTextAvailable: true,
  }

  try {
    const resumeResult = await pool.query(
      `SELECT id, filename, raw_text, parse_result
       FROM resumes
       WHERE user_id = $1
         AND COALESCE(parse_status, 'complete') = 'complete'
       ORDER BY updated_at DESC`,
      [req.userId],
    )

    if (resumeResult.rows.length === 0) {
      return res.status(404).json({ error: 'No parsed resumes found for this user' })
    }

    const updatedCandidates = []

    for (const row of resumeResult.rows) {
      const resumeText = resolveResumeTextForReanalysis(row)
      if (!resumeText) {
        const previousCandidates = Array.isArray(row.parse_result?.candidates) ? row.parse_result.candidates : []
        const rescoredPrevious = applyJobDescriptionScoringMode(previousCandidates, jobDescriptionContext)
        const canonicalizedPrevious = canonicalizeAnalysisScoreFields(rescoredPrevious, { jobDescriptionContext })
        updatedCandidates.push(...canonicalizedPrevious)
        continue
      }

      const aiResponse = await analyzeResumeWithConfiguredFallback(
        Buffer.from(resumeText, 'utf8').toString('base64'),
        'text/plain',
        row.filename || `resume-${row.id}.txt`,
        { jobDescriptionContext },
      )

      const analyzedCandidates = Array.isArray(aiResponse?.result?.candidates) ? aiResponse.result.candidates : []
      const normalizedCandidates = analyzedCandidates.map((candidate) => normalizeCandidateFromAnalysis(candidate, row.id, row.filename))
      const scoredCandidates = applyJobDescriptionScoringMode(normalizedCandidates, jobDescriptionContext)
      const canonicalizedCandidates = canonicalizeAnalysisScoreFields(scoredCandidates, { jobDescriptionContext })
      const primaryCandidate = canonicalizedCandidates[0] || null

      const parseResult = {
        ...(row.parse_result && typeof row.parse_result === 'object' ? row.parse_result : {}),
        methodUsed: aiResponse?.provider || aiResponse?.result?.methodUsed || 'ai-reanalyse',
        jobDescriptionContextUsed: true,
        jobDescriptionContextSource: 'manual_text',
        jobDescriptionContextMissingReason: null,
        candidates: canonicalizedCandidates,
      }

      await pool.query(
        `UPDATE resumes
         SET parse_result = $2::jsonb,
             profile_score = $3,
             years_experience = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [
          row.id,
          JSON.stringify(parseResult),
          normalizeNullableNumber(primaryCandidate?.profile_score),
          normalizeNullableNumber(primaryCandidate?.years_experience),
        ],
      )

      updatedCandidates.push(...canonicalizedCandidates)
    }

    await pool.query(
      `UPDATE parse_jobs
       SET result = $2::jsonb,
           updated_at = NOW()
       WHERE id = (
         SELECT id
         FROM parse_jobs
         WHERE user_id = $1
           AND status = 'complete'
         ORDER BY updated_at DESC
         LIMIT 1
       )`,
      [req.userId, JSON.stringify({ candidates: updatedCandidates })],
    )

    await syncCandidateProfilesForUser(req.userId)

    return res.json({
      ok: true,
      updatedCount: resumeResult.rows.length,
      candidateCount: updatedCandidates.length,
    })
  } catch (error) {
    console.error('[Candidates] Failed to reanalyse candidates:', error)
    return res.status(500).json({ error: 'Unable to reanalyse candidates' })
  }
})

router.get('/profiles', requireAuth, async (req, res) => {
  try {
    await syncCandidateProfilesForUser(req.userId)

    const result = await pool.query(
      `SELECT user_id,
              resume_id,
              profile,
              source_parse_job_id,
              source_updated_at,
              schema_version,
              created_at,
              updated_at
       FROM candidate_profiles
       WHERE user_id = $1
       ORDER BY source_updated_at DESC, updated_at DESC`,
      [req.userId],
    )

    return res.json({
      profiles: result.rows.map((row) => ({
        userId: Number(row.user_id),
        resumeId: String(row.resume_id),
        profile: row.profile || {},
        sourceParseJobId: row.source_parse_job_id || null,
        sourceUpdatedAt: row.source_updated_at,
        schemaVersion: row.schema_version || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    })
  } catch (error) {
    console.error('[Candidates] Failed to fetch candidate profiles:', error)
    return res.status(500).json({ error: 'Unable to fetch candidate profiles' })
  }
})

router.get('/directory', requireAuth, async (req, res) => {
  const routeStartedAt = Date.now()
  const syncOnReadEnabled = isCandidateDirectorySyncOnReadEnabled()

  try {
    let syncDurationMs = null
    if (syncOnReadEnabled) {
      const syncStartedAt = Date.now()
      await syncCandidateProfilesForUser(req.userId)
      syncDurationMs = Date.now() - syncStartedAt
    }

    const normalizedQuery = normalizeCandidateDirectoryQuery(req.query)
    const filters = {
      skills: parseStringList(req.query.skills).map((skill) => skill.toLowerCase()),
      tags: parseStringList(req.query.tags).map((tag) => tag.toLowerCase()),
      experienceMin: normalizeNumberFilter(req.query.experienceMin),
      experienceMax: normalizeNumberFilter(req.query.experienceMax),
      scoreMin: normalizeNumberFilter(req.query.scoreMin),
      scoreMax: normalizeNumberFilter(req.query.scoreMax),
      sourceJobId: normalizeString(req.query.sourceJobId),
      sourceAnalysisId: normalizeString(req.query.sourceAnalysisId),
      search: normalizedQuery.search,
      job: normalizedQuery.job,
      parseStatus: normalizedQuery.parseStatus,
    }

    const result = await pool.query(
      `SELECT cp.resume_id,
              cp.profile,
              cp.source_parse_job_id,
              cp.source_updated_at,
              cp.updated_at,
              r.filename,
              r.original_filename,
              r.file_extension,
              r.file_type,
              r.profile_score,
              r.years_experience,
              COALESCE(r.parse_status, 'complete') AS parse_status,
              r.job_description_id,
              jd.title AS job_title,
              COALESCE(tag_agg.tags, ARRAY[]::text[]) AS tags
       FROM candidate_profiles cp
       INNER JOIN resumes r ON r.id = cp.resume_id AND r.user_id = cp.user_id
       LEFT JOIN job_descriptions jd ON jd.id = r.job_description_id
       LEFT JOIN LATERAL (
         SELECT array_agg(ct.tag ORDER BY ct.tag) AS tags
         FROM candidate_tags ct
         WHERE ct.user_id = cp.user_id
           AND ct.resume_id = cp.resume_id
       ) tag_agg ON TRUE
       WHERE cp.user_id = $1
       ORDER BY cp.source_updated_at DESC, cp.updated_at DESC`,
      [req.userId],
    )

    const profiles = result.rows
      .map((row) => {
        const profile = row.profile && typeof row.profile === 'object' ? row.profile : {}
        const persistedProfileScore = normalizeNullableNumber(profile.profile_score)
        const persistedYearsExperience = normalizeNullableNumber(profile.years_experience)
        const fallbackProfileScore = normalizeNullableNumber(row.profile_score)
        const fallbackYearsExperience = normalizeNullableNumber(row.years_experience)
        const profileScore = persistedProfileScore ?? fallbackProfileScore
        const yearsExperience = persistedYearsExperience ?? fallbackYearsExperience
        const normalizedSkills = flattenStructuredSkills(normalizeStructuredSkills(profile.skills))
        const skills = normalizedSkills
        const nullableSkills = normalizedSkills.length > 0 ? normalizedSkills : null
        const tags = normalizeStringArray(row.tags)

        return {
          resumeId: String(row.resume_id),
          profile,
          name: normalizeString(profile.name) || normalizeString(profile.full_name) || getDisplayFilename(row) || 'Candidate',
          skills,
          profileScore,
          yearsExperience,
          normalized: {
            profileScore,
            yearsExperience,
            skills: nullableSkills,
          },
          parseHints: {
            scoreSource: persistedProfileScore !== null ? 'candidate_profile' : (fallbackProfileScore !== null ? 'resume_fallback' : 'missing'),
            experienceSource: persistedYearsExperience !== null ? 'candidate_profile' : (fallbackYearsExperience !== null ? 'resume_fallback' : 'missing'),
            skillsSource: nullableSkills ? 'candidate_profile' : 'missing',
            scoreNullable: profileScore === null,
            experienceNullable: yearsExperience === null,
            skillsNullable: nullableSkills === null,
          },
          provenanceHints: {
            sourceAnalysisId: row.source_parse_job_id || null,
            sourceUpdatedAt: row.source_updated_at,
            sourceJobId: row.job_description_id ? String(row.job_description_id) : null,
          },
          tags,
          sourceParseJobId: row.source_parse_job_id || null,
          sourceUpdatedAt: row.source_updated_at,
          associatedJob: row.job_description_id
            ? {
                id: String(row.job_description_id),
                title: normalizeString(row.job_title) || 'Untitled job',
              }
            : null,
          parseStatus: normalizeString(row.parse_status) || 'complete',
        }
      })
      .filter((entry) => {
        if (filters.search) {
          const search = filters.search.toLowerCase()
          const inName = entry.name.toLowerCase().includes(search)
          const inSkills = entry.skills.some((skill) => skill.toLowerCase().includes(search))
          const inTags = entry.tags.some((tag) => tag.toLowerCase().includes(search))
          if (!inName && !inSkills && !inTags) {
            return false
          }
        }

        if (filters.job) {
          const jobText = `${entry.associatedJob?.id || ''} ${entry.associatedJob?.title || ''}`.toLowerCase()
          if (!jobText.includes(filters.job.toLowerCase())) {
            return false
          }
        }

        if (filters.parseStatus && entry.parseStatus.toLowerCase() !== filters.parseStatus) {
          return false
        }

        if (filters.skills.length > 0) {
          const candidateSkills = entry.skills.map((skill) => skill.toLowerCase())
          if (!filters.skills.some((skill) => candidateSkills.includes(skill))) {
            return false
          }
        }

        if (filters.tags.length > 0) {
          const candidateTags = entry.tags.map((tag) => tag.toLowerCase())
          if (!filters.tags.some((tag) => candidateTags.includes(tag))) {
            return false
          }
        }

        if (filters.experienceMin !== null && (entry.yearsExperience ?? -Infinity) < filters.experienceMin) {
          return false
        }

        if (filters.experienceMax !== null && (entry.yearsExperience ?? Infinity) > filters.experienceMax) {
          return false
        }

        if (filters.scoreMin !== null && (entry.profileScore ?? -Infinity) < filters.scoreMin) {
          return false
        }

        if (filters.scoreMax !== null && (entry.profileScore ?? Infinity) > filters.scoreMax) {
          return false
        }

        if (filters.sourceJobId && entry.associatedJob?.id !== filters.sourceJobId) {
          return false
        }

        if (filters.sourceAnalysisId && entry.sourceParseJobId !== filters.sourceAnalysisId) {
          return false
        }

        return true
      })

    const filtersApplied = {
      ...filters,
      sourceJobId: filters.sourceJobId || null,
      sourceAnalysisId: filters.sourceAnalysisId || null,
    }

    const response = buildDirectoryResponse(profiles, filtersApplied, req.query)

    console.info('[Candidates] Directory request completed', {
      route_total_duration_ms: Date.now() - routeStartedAt,
      sync_on_read_enabled: syncOnReadEnabled,
      ...(syncDurationMs !== null ? { sync_duration_ms: syncDurationMs } : {}),
      candidate_profiles_rows_loaded: result.rows.length,
      candidate_profiles_rows_returned: response.candidates.length,
      page: response.page,
      page_size: response.pageSize,
      sort_by: response.sortBy,
      sort_direction: response.sortDirection,
      filters_count: countAppliedFilters(filtersApplied),
    })

    return res.json(response)
  } catch (error) {
    console.error('[Candidates] Failed to fetch candidates directory:', error)
    return res.status(500).json({ error: 'Unable to fetch candidates directory' })
  }
})

router.post('/match', requireAuth, async (req, res) => {
  try {
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : []
    const jobDescriptionId = req.body?.jobDescriptionId ?? null
    const incomingJobDescription = req.body?.jobDescription || {}

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'Candidates are required for matching' })
    }

    const matchPayload = matchCandidatesToJob({
      candidates,
      jobDescription: {
        ...incomingJobDescription,
        id: incomingJobDescription.id || jobDescriptionId || null,
      },
    })

    return res.json({
      jobDescriptionId,
      ...matchPayload,
    })
  } catch (error) {
    console.error('[Candidates] Failed to calculate candidate matches:', error)
    return res.status(500).json({ error: 'Unable to calculate candidate match scores' })
  }
})

router.post('/tags/bulk', requireAuth, async (req, res) => {
  const operation = ['add', 'remove', 'replace'].includes(req.body?.operation) ? req.body.operation : null
  const tags = normalizeTags(req.body?.tags)
  const rawResumeIds = Array.isArray(req.body?.resumeIds) ? req.body.resumeIds : []
  const resumeIds = [...new Set(rawResumeIds.map((value) => resolveCandidateResumeUuid(value)).filter(Boolean))]

  if (!operation) {
    return res.status(400).json({ error: 'operation must be add, remove, or replace' })
  }

  if (resumeIds.length === 0) {
    return res.status(400).json({ error: 'resumeIds are required' })
  }

  try {
    const ownerCheck = await pool.query(
      `SELECT id
       FROM resumes
       WHERE user_id = $1
         AND id = ANY($2::uuid[])`,
      [req.userId, resumeIds],
    )
    const allowedResumeIds = ownerCheck.rows.map((row) => row.id)

    if (allowedResumeIds.length === 0) {
      return res.status(404).json({ error: 'No matching resumes found for this user' })
    }

    if (operation === 'replace') {
      await pool.query(
        `DELETE FROM candidate_tags
         WHERE user_id = $1
           AND resume_id = ANY($2::uuid[])`,
        [req.userId, allowedResumeIds],
      )
    }

    if (operation === 'remove') {
      await pool.query(
        `DELETE FROM candidate_tags
         WHERE user_id = $1
           AND resume_id = ANY($2::uuid[])
           AND tag = ANY($3::text[])`,
        [req.userId, allowedResumeIds, tags],
      )
    } else if (tags.length > 0) {
      await pool.query(
        `INSERT INTO candidate_tags (user_id, resume_id, tag)
         SELECT $1, resume_id, tag_value
         FROM unnest($2::uuid[]) AS resume_id
         CROSS JOIN unnest($3::text[]) AS tag_value
         ON CONFLICT (user_id, resume_id, tag) DO NOTHING`,
        [req.userId, allowedResumeIds, tags],
      )
    }

    const result = await pool.query(
      `SELECT resume_id, array_agg(tag ORDER BY tag) AS tags
       FROM candidate_tags
       WHERE user_id = $1
         AND resume_id = ANY($2::uuid[])
       GROUP BY resume_id`,
      [req.userId, allowedResumeIds],
    )

    return res.json({
      resumeTags: result.rows,
      updatedCount: allowedResumeIds.length,
    })
  } catch (error) {
    console.error('[Candidates] Failed to mutate tags:', error)
    return res.status(500).json({ error: 'Unable to update candidate tags' })
  }
})

router.post('/tags/lookup', requireAuth, async (req, res) => {
  const resumeIds = normalizeResumeTagLookupInput(req.body?.resumeIds)
  if (!resumeIds) {
    return res.status(400).json({ error: 'resumeIds must be an array' })
  }
  if (resumeIds.length === 0) {
    return res.json({ resumeTags: [] })
  }

  try {
    const result = await pool.query(
      `SELECT r.id AS resume_id,
              COALESCE(tag_agg.tags, ARRAY[]::text[]) AS tags
       FROM resumes r
       LEFT JOIN LATERAL (
         SELECT array_agg(ct.tag ORDER BY ct.tag) AS tags
         FROM candidate_tags ct
         WHERE ct.user_id = r.user_id
           AND ct.resume_id = r.id
       ) tag_agg ON TRUE
       WHERE r.user_id = $1
         AND r.id = ANY($2::uuid[])
       ORDER BY r.id ASC`,
      [req.userId, resumeIds],
    )

    return res.json({
      resumeTags: result.rows.map((row) => ({
        resumeId: String(row.resume_id),
        tags: normalizeTags(row.tags).sort((a, b) => a.localeCompare(b)),
      })),
    })
  } catch (error) {
    console.error('[Candidates] Failed to lookup tags:', error)
    return res.status(500).json({ error: 'Unable to lookup candidate tags' })
  }
})


router.get('/:resumeId/resume', requireAuth, async (req, res) => {
  const resumeId = normalizeString(req.params.resumeId)
  if (!resumeId) {
    return res.status(400).json({ error: 'resumeId is required' })
  }

  if (!s3Bucket) {
    return res.status(503).json({ error: 'Resume file storage is not configured' })
  }

  try {
    const uploadResult = await pool.query(
      `SELECT uc.assembled_s3_key,
              uc.filename,
              uc.mime_type,
              r.filename AS resume_filename,
              r.original_filename,
              r.file_extension,
              r.original_mime_type,
              r.file_type
       FROM upload_chunks uc
       LEFT JOIN resumes r ON r.id = uc.resume_id
       WHERE uc.user_id = $1
         AND uc.resume_id = $2
         AND uc.status = 'completed'
         AND uc.assembled_s3_key IS NOT NULL
       ORDER BY uc.updated_at DESC
       LIMIT 1`,
      [req.userId, resumeId],
    )

    const upload = uploadResult.rows[0]
    if (!upload?.assembled_s3_key) {
      return res.status(404).json({ error: 'Resume file not found for this candidate' })
    }

    const objectResponse = await s3Client.send(new GetObjectCommand({
      Bucket: s3Bucket,
      Key: upload.assembled_s3_key,
    }))

    const fileBuffer = await streamToBuffer(objectResponse.Body)
    const filename = getDisplayFilename({
      filename: normalizeString(upload.filename) || normalizeString(upload.resume_filename),
      original_filename: upload.original_filename,
      file_extension: upload.file_extension,
      file_type: upload.file_type || upload.mime_type,
    }) || `resume-${resumeId}`
    const contentType = normalizeString(upload.mime_type) || normalizeString(upload.file_type) || objectResponse.ContentType || 'application/octet-stream'

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`)
    return res.send(fileBuffer)
  } catch (error) {
    console.error('[Candidates] Failed to open candidate resume:', error)
    return res.status(500).json({ error: 'Unable to load candidate resume file' })
  }
})

router.get('/:resumeId', requireAuth, async (req, res) => {
  const resumeId = normalizeString(req.params.resumeId)
  if (!resumeId) {
    return res.status(400).json({ error: 'resumeId is required' })
  }

  try {
    await syncCandidateProfilesForUser(req.userId)

    const result = await pool.query(
      `SELECT cp.resume_id,
              cp.profile,
              cp.source_parse_job_id,
              cp.source_updated_at,
              cp.created_at,
              cp.updated_at,
              r.filename,
              r.original_filename,
              r.file_extension,
              r.file_type,
              r.profile_score,
              r.years_experience,
              r.job_description_id,
              jd.title AS job_title,
              COALESCE(tag_agg.tags, ARRAY[]::text[]) AS tags
       FROM candidate_profiles cp
       INNER JOIN resumes r ON r.id = cp.resume_id AND r.user_id = cp.user_id
       LEFT JOIN job_descriptions jd ON jd.id = r.job_description_id
       LEFT JOIN LATERAL (
         SELECT array_agg(ct.tag ORDER BY ct.tag) AS tags
         FROM candidate_tags ct
         WHERE ct.user_id = cp.user_id
           AND ct.resume_id = cp.resume_id
       ) tag_agg ON TRUE
       WHERE cp.user_id = $1
         AND cp.resume_id = $2
       LIMIT 1`,
      [req.userId, resumeId],
    )

    const row = result.rows[0]
    if (!row) {
      return res.status(404).json({ error: 'Candidate not found' })
    }

    const profile = row.profile && typeof row.profile === 'object' ? row.profile : {}

    return res.json({
      resumeId: String(row.resume_id),
      profile,
      fields: {
        name: normalizeString(profile.name) || normalizeString(profile.full_name) || getDisplayFilename(row) || 'Candidate',
        email: normalizeString(profile.email),
        phone: normalizeString(profile.phone),
        summary: normalizeString(profile.summary),
        location: normalizeString(profile.location),
        skills: flattenStructuredSkills(normalizeStructuredSkills(profile.skills)),
        strengths: normalizeStringArray(profile.strengths),
        considerations: normalizeStringArray(profile.considerations),
        yearsExperience: normalizeNullableNumber(profile.years_experience) ?? normalizeNullableNumber(row.years_experience),
        profileScore: normalizeNullableNumber(profile.profile_score) ?? normalizeNullableNumber(row.profile_score),
        tags: normalizeStringArray(row.tags),
      },
      provenance: {
        latestAnalysisTimestamp: row.source_updated_at,
        sourceAnalysisId: row.source_parse_job_id || null,
        associatedJob: row.job_description_id
          ? {
              id: String(row.job_description_id),
              title: normalizeString(row.job_title) || 'Untitled job',
            }
          : null,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  } catch (error) {
    console.error('[Candidates] Failed to fetch candidate detail:', error)
    return res.status(500).json({ error: 'Unable to fetch candidate detail' })
  }
})


export default router
