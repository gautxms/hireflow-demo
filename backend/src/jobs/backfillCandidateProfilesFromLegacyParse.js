import 'dotenv/config'
import { pool } from '../db/client.js'
import { CANDIDATE_PROFILE_SCHEMA_VERSION } from '../services/candidateProfilesService.js'

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: true,
    userId: null,
    limit: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim()

    if (arg === '--execute') {
      options.dryRun = false
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--user-id') {
      options.userId = Number(argv[index + 1] || 0) || null
      index += 1
      continue
    }

    if (arg === '--limit') {
      options.limit = Number(argv[index + 1] || 0) || null
      index += 1
    }
  }

  return options
}

function pickPrimaryCandidate(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.candidates)) {
    return null
  }

  const firstCandidate = payload.candidates[0]
  if (!firstCandidate || typeof firstCandidate !== 'object') {
    return null
  }

  return firstCandidate
}

function resolveProfilePayload({ resumeParseResult, resumeUpdatedAt, parseJobResult, parseJobUpdatedAt, parseJobId }) {
  const resumeCandidate = pickPrimaryCandidate(resumeParseResult)
  if (resumeCandidate) {
    return {
      profile: resumeCandidate,
      sourceParseJobId: null,
      sourceUpdatedAt: resumeUpdatedAt || new Date(),
      provenance: 'resume',
    }
  }

  const parseJobCandidate = pickPrimaryCandidate(parseJobResult)
  if (!parseJobCandidate) {
    return null
  }

  return {
    profile: parseJobCandidate,
    sourceParseJobId: parseJobId || null,
    sourceUpdatedAt: parseJobUpdatedAt || resumeUpdatedAt || new Date(),
    provenance: 'parse_job',
  }
}

function getOrCreateUserStats(countsByUser, userId) {
  const key = String(userId)
  if (!countsByUser.has(key)) {
    countsByUser.set(key, {
      resumesScanned: 0,
      profilesResolved: 0,
      profilesUpserted: 0,
      missingLinks: 0,
      failedRows: 0,
    })
  }

  return countsByUser.get(key)
}

export async function backfillCandidateProfilesFromLegacyParse({ dryRun = true, userId = null, limit = null } = {}) {
  const result = {
    dryRun,
    scanned: 0,
    profilesResolved: 0,
    profilesUpserted: 0,
    missingLinks: [],
    failedRows: [],
    countsByUser: {},
  }

  const rows = await pool.query(
    `SELECT r.id AS resume_id,
            r.user_id,
            r.updated_at AS resume_updated_at,
            r.parse_result AS resume_parse_result,
            pj.job_id AS source_parse_job_id,
            pj.updated_at AS parse_job_updated_at,
            pj.result AS parse_job_result
     FROM resumes r
     LEFT JOIN LATERAL (
       SELECT job_id, updated_at, result
       FROM parse_jobs
       WHERE resume_id = r.id
         AND user_id = r.user_id
         AND status IN ('complete', 'completed')
       ORDER BY updated_at DESC
       LIMIT 1
     ) pj ON TRUE
     WHERE ($1::int IS NULL OR r.user_id = $1)
     ORDER BY r.created_at ASC
     LIMIT COALESCE($2::int, 2147483647)`,
    [userId ? Number(userId) : null, limit ? Number(limit) : null],
  )

  const countsByUser = new Map()

  for (const row of rows.rows) {
    result.scanned += 1

    const resolvedUserId = Number(row.user_id || 0)
    const userStats = resolvedUserId > 0 ? getOrCreateUserStats(countsByUser, resolvedUserId) : null

    if (userStats) {
      userStats.resumesScanned += 1
    }

    if (!resolvedUserId) {
      result.missingLinks.push({
        type: 'resume_missing_user_id',
        resumeId: String(row.resume_id || ''),
      })
      continue
    }

    const profilePayload = resolveProfilePayload({
      resumeParseResult: row.resume_parse_result,
      resumeUpdatedAt: row.resume_updated_at,
      parseJobResult: row.parse_job_result,
      parseJobUpdatedAt: row.parse_job_updated_at,
      parseJobId: row.source_parse_job_id,
    })

    if (!profilePayload) {
      result.missingLinks.push({
        type: 'profile_not_derivable',
        userId: resolvedUserId,
        resumeId: String(row.resume_id),
        sourceParseJobId: row.source_parse_job_id ? String(row.source_parse_job_id) : null,
      })
      if (userStats) {
        userStats.missingLinks += 1
      }
      continue
    }

    result.profilesResolved += 1
    if (userStats) {
      userStats.profilesResolved += 1
    }

    if (dryRun) {
      result.profilesUpserted += 1
      if (userStats) {
        userStats.profilesUpserted += 1
      }
      continue
    }

    try {
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
          resolvedUserId,
          row.resume_id,
          JSON.stringify(profilePayload.profile),
          profilePayload.sourceParseJobId ? String(profilePayload.sourceParseJobId) : null,
          profilePayload.sourceUpdatedAt,
          CANDIDATE_PROFILE_SCHEMA_VERSION,
        ],
      )

      result.profilesUpserted += 1
      if (userStats) {
        userStats.profilesUpserted += 1
      }
    } catch (error) {
      result.failedRows.push({
        userId: resolvedUserId,
        resumeId: String(row.resume_id),
        sourceParseJobId: row.source_parse_job_id ? String(row.source_parse_job_id) : null,
        reason: error.message,
      })
      if (userStats) {
        userStats.failedRows += 1
      }
    }
  }

  result.countsByUser = Object.fromEntries(Array.from(countsByUser.entries()))

  return result
}

async function runCli() {
  const options = parseCliArgs()
  console.log(`[Backfill:candidate-profiles] Starting (${options.dryRun ? 'dry-run' : 'execute'})`)

  try {
    const reconciliation = await backfillCandidateProfilesFromLegacyParse(options)

    console.log('[Backfill:candidate-profiles] Reconciliation summary')
    console.log(JSON.stringify(reconciliation, null, 2))
  } catch (error) {
    console.error('[Backfill:candidate-profiles] Failed:', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
}
