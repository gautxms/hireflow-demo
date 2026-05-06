import 'dotenv/config'
import { pool } from '../db/client.js'

const SKILLS_STRUCTURED_KEYS = ['tools_and_platforms', 'methodologies', 'domain_expertise', 'soft_skills']

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: true,
    userId: null,
    limit: 500,
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
      continue
    }
  }

  return options
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (value === null || value === undefined || value === '') {
    return []
  }

  return [value]
}

function sanitizeCandidateSkillsStructured(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { candidate, changed: false, changedKeys: [] }
  }

  const skills = candidate.skills_structured
  if (!skills || typeof skills !== 'object' || Array.isArray(skills)) {
    return { candidate, changed: false, changedKeys: [] }
  }

  let changed = false
  const changedKeys = []
  const nextSkills = { ...skills }

  for (const key of SKILLS_STRUCTURED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(nextSkills, key)) {
      continue
    }

    const originalValue = nextSkills[key]
    if (Array.isArray(originalValue)) {
      continue
    }

    nextSkills[key] = toArray(originalValue)
    changed = true
    changedKeys.push(key)
  }

  if (!changed) {
    return { candidate, changed: false, changedKeys: [] }
  }

  return {
    candidate: {
      ...candidate,
      skills_structured: nextSkills,
    },
    changed: true,
    changedKeys,
  }
}

function sanitizeParseResult(payload) {
  if (!payload || typeof payload !== 'object') {
    return { payload, changed: false, audit: [] }
  }

  const candidates = payload.candidates
  if (!Array.isArray(candidates)) {
    return { payload, changed: false, audit: [] }
  }

  const audit = []
  let changed = false
  const nextCandidates = candidates.map((candidate, index) => {
    const sanitized = sanitizeCandidateSkillsStructured(candidate)
    if (!sanitized.changed) {
      return candidate
    }

    changed = true
    audit.push({
      candidateIndex: index,
      changedKeys: sanitized.changedKeys,
      originalSkillsStructured: candidate.skills_structured,
    })

    return sanitized.candidate
  })

  if (!changed) {
    return { payload, changed: false, audit: [] }
  }

  return {
    payload: {
      ...payload,
      candidates: nextCandidates,
      sanitizer_audit: {
        ...(payload.sanitizer_audit && typeof payload.sanitizer_audit === 'object' ? payload.sanitizer_audit : {}),
        skills_structured_backfill: {
          touchedAt: new Date().toISOString(),
          candidateChanges: audit,
        },
      },
    },
    changed: true,
    audit,
  }
}

export async function backfillParseJobSkillsStructured({ dryRun = true, userId = null, limit = 500 } = {}) {
  const result = {
    dryRun,
    scanned: 0,
    changed: 0,
    unchanged: 0,
    failed: [],
    updatedJobIds: [],
  }

  const rows = await pool.query(
    `SELECT pj.job_id, pj.result
     FROM parse_jobs pj
     WHERE pj.result IS NOT NULL
       AND ($1::int IS NULL OR pj.user_id = $1)
     ORDER BY pj.updated_at DESC
     LIMIT COALESCE($2::int, 500)`,
    [userId ? Number(userId) : null, limit ? Number(limit) : null],
  )

  for (const row of rows.rows) {
    result.scanned += 1

    const sanitized = sanitizeParseResult(row.result)
    if (!sanitized.changed) {
      result.unchanged += 1
      continue
    }

    if (dryRun) {
      result.changed += 1
      result.updatedJobIds.push(String(row.job_id))
      continue
    }

    try {
      await pool.query(
        `UPDATE parse_jobs
         SET result = $2::jsonb,
             updated_at = NOW()
         WHERE job_id = $1`,
        [String(row.job_id), JSON.stringify(sanitized.payload)],
      )
      result.changed += 1
      result.updatedJobIds.push(String(row.job_id))
    } catch (error) {
      result.failed.push({ jobId: String(row.job_id), reason: error.message })
    }
  }

  return result
}

async function runCli() {
  const options = parseCliArgs()
  console.log(`[Backfill:parse-job-skills] Starting (${options.dryRun ? 'dry-run' : 'execute'})`)

  try {
    const summary = await backfillParseJobSkillsStructured(options)
    console.log('[Backfill:parse-job-skills] Reconciliation summary')
    console.log(JSON.stringify(summary, null, 2))
  } catch (error) {
    console.error('[Backfill:parse-job-skills] Failed:', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
}
