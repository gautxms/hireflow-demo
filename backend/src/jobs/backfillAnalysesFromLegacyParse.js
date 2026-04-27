import 'dotenv/config'
import { pool } from '../db/client.js'

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

function deriveAnalysisStatus(parseJobStatus) {
  if (parseJobStatus === 'complete') {
    return 'complete'
  }

  if (parseJobStatus === 'failed') {
    return 'failed'
  }

  if (parseJobStatus === 'processing' || parseJobStatus === 'retrying') {
    return 'processing'
  }

  return 'pending'
}

function getOrCreateUserStats(countsByUser, userId) {
  const key = String(userId)
  if (!countsByUser.has(key)) {
    countsByUser.set(key, {
      parseJobsScanned: 0,
      alreadyLinked: 0,
      analysesCreated: 0,
      missingLinks: 0,
      failedRows: 0,
    })
  }

  return countsByUser.get(key)
}

export async function backfillAnalysesFromLegacyParse({ dryRun = true, userId = null, limit = null } = {}) {
  const result = {
    dryRun,
    scanned: 0,
    alreadyLinked: 0,
    analysesCreated: 0,
    missingLinks: [],
    failedRows: [],
    countsByUser: {},
  }

  const parseJobsResult = await pool.query(
    `SELECT pj.job_id,
            pj.resume_id,
            pj.user_id AS parse_user_id,
            pj.status,
            pj.error_message,
            pj.created_at,
            pj.updated_at,
            r.user_id AS resume_user_id,
            r.job_description_id,
            ai.analysis_id AS linked_analysis_id
     FROM parse_jobs pj
     LEFT JOIN resumes r ON r.id = pj.resume_id
     LEFT JOIN analysis_items ai ON ai.parse_job_id = pj.job_id
     WHERE ($1::int IS NULL OR COALESCE(pj.user_id, r.user_id) = $1)
     ORDER BY pj.created_at ASC
     LIMIT COALESCE($2::int, 2147483647)`,
    [userId ? Number(userId) : null, limit ? Number(limit) : null],
  )

  const countsByUser = new Map()

  for (const row of parseJobsResult.rows) {
    result.scanned += 1

    const resolvedUserId = Number(row.parse_user_id || row.resume_user_id || 0)
    const userStats = resolvedUserId > 0 ? getOrCreateUserStats(countsByUser, resolvedUserId) : null

    if (userStats) {
      userStats.parseJobsScanned += 1
    }

    if (!row.resume_id) {
      result.missingLinks.push({
        type: 'parse_job_missing_resume_id',
        parseJobId: String(row.job_id || ''),
        resumeId: null,
      })
      if (userStats) {
        userStats.missingLinks += 1
      }
      continue
    }

    if (!row.resume_user_id) {
      result.missingLinks.push({
        type: 'parse_job_resume_not_found',
        parseJobId: String(row.job_id || ''),
        resumeId: String(row.resume_id),
      })
      if (userStats) {
        userStats.missingLinks += 1
      }
      continue
    }

    if (row.parse_user_id && Number(row.parse_user_id) !== Number(row.resume_user_id)) {
      result.missingLinks.push({
        type: 'parse_job_resume_user_mismatch',
        parseJobId: String(row.job_id || ''),
        parseJobUserId: Number(row.parse_user_id),
        resumeUserId: Number(row.resume_user_id),
        resumeId: String(row.resume_id),
      })
      if (userStats) {
        userStats.missingLinks += 1
      }
      continue
    }

    if (row.linked_analysis_id) {
      result.alreadyLinked += 1
      if (userStats) {
        userStats.alreadyLinked += 1
      }
      continue
    }

    const analysisStatus = deriveAnalysisStatus(String(row.status || 'pending'))
    const completedAt = analysisStatus === 'complete' || analysisStatus === 'failed' ? row.updated_at || row.created_at : null

    if (dryRun) {
      result.analysesCreated += 1
      if (userStats) {
        userStats.analysesCreated += 1
      }
      continue
    }

    try {
      const insertedAnalysis = await pool.query(
        `INSERT INTO analyses (user_id, job_description_id, status, created_at, completed_at, error_summary)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          Number(row.resume_user_id),
          row.job_description_id || null,
          analysisStatus,
          row.created_at || new Date(),
          completedAt,
          analysisStatus === 'failed' ? String(row.error_message || '').slice(0, 500) || null : null,
        ],
      )

      const analysisId = insertedAnalysis.rows[0]?.id

      await pool.query(
        `INSERT INTO analysis_items (analysis_id, resume_id, parse_job_id, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (analysis_id, resume_id) DO NOTHING`,
        [analysisId, row.resume_id, String(row.job_id), row.created_at || new Date()],
      )

      result.analysesCreated += 1
      if (userStats) {
        userStats.analysesCreated += 1
      }
    } catch (error) {
      const failedRow = {
        parseJobId: String(row.job_id || ''),
        resumeId: String(row.resume_id || ''),
        userId: Number(row.resume_user_id || row.parse_user_id || 0) || null,
        reason: error.message,
      }
      result.failedRows.push(failedRow)
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
  console.log(`[Backfill:analyses] Starting (${options.dryRun ? 'dry-run' : 'execute'})`) 

  try {
    const reconciliation = await backfillAnalysesFromLegacyParse(options)

    console.log('[Backfill:analyses] Reconciliation summary')
    console.log(JSON.stringify(reconciliation, null, 2))
  } catch (error) {
    console.error('[Backfill:analyses] Failed:', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
}
