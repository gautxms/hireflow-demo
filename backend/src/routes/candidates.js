import { Router } from 'express'
import { Buffer } from 'node:buffer'
import { requireAuth } from '../middleware/authMiddleware.js'
import { matchCandidatesToJob } from '../services/matchingService.js'
import { pool } from '../db/client.js'
import { normalizeTags } from './candidateTagsState.js'
import { analyzeResumeWithConfiguredFallback } from '../services/aiResumeAnalysisService.js'
import { applyJobDescriptionScoringMode } from '../jobs/parseResumeJob.js'
import { syncCandidateProfilesForUser } from '../services/candidateProfilesService.js'
import { resolveCandidateResumeUuid, resolveCanonicalCandidateIdentity } from '../utils/candidateIdentity.js'

const router = Router()

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
        updatedCandidates.push(...rescoredPrevious)
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
      const primaryCandidate = scoredCandidates[0] || null

      const parseResult = {
        ...(row.parse_result && typeof row.parse_result === 'object' ? row.parse_result : {}),
        methodUsed: aiResponse?.provider || aiResponse?.result?.methodUsed || 'ai-reanalyse',
        jobDescriptionContextUsed: true,
        jobDescriptionContextSource: 'manual_text',
        jobDescriptionContextMissingReason: null,
        candidates: scoredCandidates,
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

      updatedCandidates.push(...scoredCandidates)
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
  try {
    await syncCandidateProfilesForUser(req.userId)

    const filters = {
      skills: parseStringList(req.query.skills).map((skill) => skill.toLowerCase()),
      tags: parseStringList(req.query.tags).map((tag) => tag.toLowerCase()),
      experienceMin: normalizeNumberFilter(req.query.experienceMin),
      experienceMax: normalizeNumberFilter(req.query.experienceMax),
      scoreMin: normalizeNumberFilter(req.query.scoreMin),
      scoreMax: normalizeNumberFilter(req.query.scoreMax),
      sourceJobId: normalizeString(req.query.sourceJobId),
      sourceAnalysisId: normalizeString(req.query.sourceAnalysisId),
    }

    const result = await pool.query(
      `SELECT cp.resume_id,
              cp.profile,
              cp.source_parse_job_id,
              cp.source_updated_at,
              cp.updated_at,
              r.filename,
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
       ORDER BY cp.source_updated_at DESC, cp.updated_at DESC`,
      [req.userId],
    )

    const profiles = result.rows
      .map((row) => {
        const profile = row.profile && typeof row.profile === 'object' ? row.profile : {}
        const skills = flattenStructuredSkills(normalizeStructuredSkills(profile.skills))
        const profileScore = normalizeNullableNumber(profile.profile_score) ?? normalizeNullableNumber(row.profile_score)
        const yearsExperience = normalizeNullableNumber(profile.years_experience) ?? normalizeNullableNumber(row.years_experience)
        const tags = normalizeStringArray(row.tags)

        return {
          resumeId: String(row.resume_id),
          profile,
          name: normalizeString(profile.name) || normalizeString(profile.full_name) || normalizeString(row.filename) || 'Candidate',
          skills,
          profileScore,
          yearsExperience,
          tags,
          sourceParseJobId: row.source_parse_job_id || null,
          sourceUpdatedAt: row.source_updated_at,
          associatedJob: row.job_description_id
            ? {
                id: String(row.job_description_id),
                title: normalizeString(row.job_title) || 'Untitled job',
              }
            : null,
        }
      })
      .filter((entry) => {
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

    return res.json({
      candidates: profiles,
      total: profiles.length,
      filtersApplied: {
        ...filters,
        sourceJobId: filters.sourceJobId || null,
        sourceAnalysisId: filters.sourceAnalysisId || null,
      },
    })
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
        name: normalizeString(profile.name) || normalizeString(profile.full_name) || normalizeString(row.filename) || 'Candidate',
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
