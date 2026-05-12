import { pool } from '../db/client.js'

export const CANDIDATE_PROFILE_SCHEMA_VERSION = 'v1'

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now())
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function pickPrimaryCandidate(payload) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  if (Array.isArray(payload.candidates) && payload.candidates.length > 0) {
    const candidates = payload.candidates.filter((candidate) => candidate && typeof candidate === 'object')
    if (candidates.length === 0) {
      return null
    }

    const first = candidates[0]
    const scoreCandidateCompleteness = (candidate) => {
      const hasName = Boolean(String(candidate.full_name || candidate.name || '').trim())
      const hasScore = Number.isFinite(Number(candidate.score))

      const experienceRaw = candidate.experience ?? candidate.experienceYears ?? candidate.years_experience
      const hasExperience = Number.isFinite(Number(experienceRaw)) || Boolean(String(experienceRaw || '').trim())

      const skills = candidate.skills
      const hasSkills = Array.isArray(skills)
        ? skills.some((skill) => Boolean(String(skill || '').trim()))
        : Boolean(String(skills || '').trim())

      return Number(hasName) + Number(hasScore || hasExperience || hasSkills)
    }

    let bestCandidate = first
    let bestScore = scoreCandidateCompleteness(first)
    let hasTie = false

    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i]
      const candidateScore = scoreCandidateCompleteness(candidate)
      if (candidateScore > bestScore) {
        bestCandidate = candidate
        bestScore = candidateScore
        hasTie = false
      } else if (candidateScore === bestScore) {
        hasTie = true
      }
    }

    if (!hasTie && bestScore > scoreCandidateCompleteness(first)) {
      return bestCandidate
    }

    return first
  }

  return null
}

function resolveProfilePayload({
  resumeParseResult,
  resumeUpdatedAt,
  parseJobResult,
  parseJobUpdatedAt,
  parseJobId,
}) {
  const fromResume = pickPrimaryCandidate(resumeParseResult)
  if (fromResume) {
    return {
      profile: fromResume,
      sourceParseJobId: null,
      sourceUpdatedAt: resumeUpdatedAt || new Date(),
    }
  }

  const fromParseJob = pickPrimaryCandidate(parseJobResult)
  if (!fromParseJob) {
    return null
  }

  return {
    profile: fromParseJob,
    sourceParseJobId: parseJobId || null,
    sourceUpdatedAt: parseJobUpdatedAt || resumeUpdatedAt || new Date(),
  }
}

export async function upsertCandidateProfile({
  userId,
  resumeId,
  profile,
  sourceParseJobId = null,
  sourceUpdatedAt = null,
  schemaVersion = CANDIDATE_PROFILE_SCHEMA_VERSION,
}) {
  if (!userId || !resumeId || !profile || typeof profile !== 'object') {
    return false
  }

  await pool.query(
    `INSERT INTO candidate_profiles (
       user_id,
       resume_id,
       profile,
       source_parse_job_id,
       source_updated_at,
       schema_version
     )
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     ON CONFLICT (user_id, resume_id)
     DO UPDATE SET
       profile = EXCLUDED.profile,
       source_parse_job_id = EXCLUDED.source_parse_job_id,
       source_updated_at = EXCLUDED.source_updated_at,
       schema_version = EXCLUDED.schema_version,
       updated_at = NOW()`,
    [
      userId,
      resumeId,
      JSON.stringify(profile),
      sourceParseJobId ? String(sourceParseJobId) : null,
      normalizeTimestamp(sourceUpdatedAt),
      String(schemaVersion || CANDIDATE_PROFILE_SCHEMA_VERSION),
    ],
  )

  return true
}

export async function syncCandidateProfilesForUser(userId) {
  if (!userId) {
    return 0
  }

  const resumeRows = await pool.query(
    `SELECT r.id AS resume_id,
            r.parse_result AS resume_parse_result,
            r.updated_at AS resume_updated_at,
            pj.job_id AS source_parse_job_id,
            pj.result AS parse_job_result,
            pj.updated_at AS parse_job_updated_at
     FROM resumes r
     LEFT JOIN LATERAL (
       SELECT job_id, result, updated_at
       FROM parse_jobs
       WHERE resume_id = r.id
         AND user_id = r.user_id
         AND status = 'complete'
       ORDER BY updated_at DESC
       LIMIT 1
     ) pj ON TRUE
     WHERE r.user_id = $1`,
    [userId],
  )

  let syncedCount = 0

  for (const row of resumeRows.rows) {
    const resolvedProfile = resolveProfilePayload({
      resumeParseResult: row.resume_parse_result,
      resumeUpdatedAt: row.resume_updated_at,
      parseJobResult: row.parse_job_result,
      parseJobUpdatedAt: row.parse_job_updated_at,
      parseJobId: row.source_parse_job_id,
    })

    if (!resolvedProfile) {
      await pool.query(
        `DELETE FROM candidate_profiles
         WHERE user_id = $1
           AND resume_id = $2`,
        [userId, row.resume_id],
      )
      continue
    }

    await upsertCandidateProfile({
      userId,
      resumeId: row.resume_id,
      profile: resolvedProfile.profile,
      sourceParseJobId: resolvedProfile.sourceParseJobId,
      sourceUpdatedAt: resolvedProfile.sourceUpdatedAt,
      schemaVersion: CANDIDATE_PROFILE_SCHEMA_VERSION,
    })

    syncedCount += 1
  }

  return syncedCount
}
