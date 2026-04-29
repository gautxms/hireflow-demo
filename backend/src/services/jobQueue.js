import Bull from 'bull'
import { pool } from '../db/client.js'

const SECONDS_IN_DAY = 24 * 60 * 60
const JOB_RETENTION_SECONDS = 7 * SECONDS_IN_DAY
const RESULT_CACHE_TTL_SECONDS = SECONDS_IN_DAY

const redisConfig = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number.parseInt(process.env.REDIS_DB || '0', 10),
    }

export const parseQueue = new Bull('resume-parse-jobs', redisConfig)

export async function ensureParseJobsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parse_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id TEXT UNIQUE NOT NULL,
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      result JSONB,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '7 days'
    );

    CREATE INDEX IF NOT EXISTS idx_parse_jobs_status ON parse_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_parse_jobs_resume_id ON parse_jobs(resume_id);
    CREATE INDEX IF NOT EXISTS idx_parse_jobs_user_id ON parse_jobs(user_id);
  `)
}

export function getResultCacheKey(jobId) {
  return `parse-job-result:${jobId}`
}

export async function cacheJobResult(jobId, payload) {
  const client = await parseQueue.client
  await client.set(getResultCacheKey(jobId), JSON.stringify(payload), 'EX', RESULT_CACHE_TTL_SECONDS)
}

export async function getCachedJobResult(jobId) {
  const client = await parseQueue.client
  const raw = await client.get(getResultCacheKey(jobId))

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function enqueueParseJob({
  resumeId,
  userId,
  filename,
  mimeType,
  fileSize,
  fileBufferBase64,
  jobDescriptionId = null,
}) {
  const existing = await pool.query(
    `SELECT job_id
     FROM parse_jobs
     WHERE resume_id = $1
       AND status IN ('pending', 'processing', 'retrying')
     ORDER BY created_at DESC
     LIMIT 1`,
    [resumeId],
  )

  if (existing.rows[0]?.job_id) {
    const existingJob = await parseQueue.getJob(String(existing.rows[0].job_id))
    if (existingJob) {
      return existingJob
    }
  }

  const job = await parseQueue.add(
    {
      resumeId,
      userId,
      filename,
      mimeType,
      fileSize,
      fileBufferBase64,
      jobDescriptionId,
    },
    {
      jobId: `resume:${resumeId}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        age: JOB_RETENTION_SECONDS,
      },
      removeOnFail: {
        age: JOB_RETENTION_SECONDS,
      },
    },
  )

  await pool.query(
    `INSERT INTO parse_jobs (job_id, resume_id, user_id, status, progress, attempts, expires_at)
     VALUES ($1, $2, $3, 'pending', 0, 0, NOW() + INTERVAL '7 days')
     ON CONFLICT (job_id)
     DO UPDATE SET
       resume_id = EXCLUDED.resume_id,
       user_id = EXCLUDED.user_id,
       updated_at = NOW()`,
    [String(job.id), resumeId, userId],
  )

  return job
}

export async function initializeJobQueue() {
  await ensureParseJobsTable()
  console.log('[Queue] Resume parse queue initialized')
}
