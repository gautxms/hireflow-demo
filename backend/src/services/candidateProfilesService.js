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
    const first = payload.candidates[0]
    return first && typeof first === 'object' ? first : null
  }

  return null
}

function resolveProfilePayload({ resumeParseResult, parseJobResult }) {
  const fromResume = pickPrimaryCandidate(resumeParseResult)
  if (fromResume) {
    return fromResume
  }

  return pickPrimaryCandidate(parseJobResult)
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
    const profile = resolveProfilePayload({
      resumeParseResult: row.resume_parse_result,
      parseJobResult: row.parse_job_result,
    })

    if (!profile) {
      continue
    }

    await upsertCandidateProfile({
      userId,
      resumeId: row.resume_id,
      profile,
      sourceParseJobId: row.source_parse_job_id,
      sourceUpdatedAt: row.parse_job_updated_at || row.resume_updated_at || new Date(),
      schemaVersion: CANDIDATE_PROFILE_SCHEMA_VERSION,
    })

    syncedCount += 1
  }

  return syncedCount
}
