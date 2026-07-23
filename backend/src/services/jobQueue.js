import { Buffer } from 'node:buffer'
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

    ALTER TABLE parse_jobs
      ADD COLUMN IF NOT EXISTS quota_allocation_id UUID;
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
  originalFilename,
  originalMimeType,
  fileExtension,
  mimeType,
  mimetype,
  fileSize,
  assembledS3Key = null,
  assembledSha256 = null,
  fileBufferBase64,
  fileBuffer,
  analysisId = null,
  jobDescriptionId = null,
  quotaAllocationId = null,
}) {
  const resolvedMimeType = mimeType || mimetype || null
  const resolvedFileSize = fileSize !== null && fileSize !== undefined && fileSize !== '' && Number.isFinite(Number(fileSize))
    ? Number(fileSize)
    : (fileBuffer ? Buffer.from(fileBuffer).length : null)
  const resolvedFileBufferBase64 = fileBufferBase64 || (fileBuffer ? Buffer.from(fileBuffer).toString('base64') : null)
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
      originalFilename: originalFilename || filename || null,
      originalMimeType: originalMimeType || null,
      fileExtension: fileExtension || null,
      mimeType: resolvedMimeType,
      fileSize: resolvedFileSize,
      assembledS3Key: assembledS3Key || null,
      assembledSha256: assembledSha256 || null,
      fileBufferBase64: resolvedFileBufferBase64,
      analysisId,
      jobDescriptionId,
      quotaAllocationId: quotaAllocationId || null,
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
    `INSERT INTO parse_jobs
      (job_id, resume_id, user_id, status, progress, attempts, quota_allocation_id, expires_at)
     VALUES ($1, $2, $3, 'pending', 0, 0, $4, NOW() + INTERVAL '7 days')
     ON CONFLICT (job_id)
     DO UPDATE SET
       resume_id = EXCLUDED.resume_id,
       user_id = EXCLUDED.user_id,
       quota_allocation_id = COALESCE(parse_jobs.quota_allocation_id, EXCLUDED.quota_allocation_id),
       updated_at = NOW()`,
    [String(job.id), resumeId, userId, quotaAllocationId || null],
  )

  if (quotaAllocationId) {
    await pool.query(
      `UPDATE resume_quota_allocations
       SET resume_id = COALESCE(resume_id, $3),
           parse_job_id = COALESCE(parse_job_id, $4),
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND (resume_id IS NULL OR resume_id = $3)
         AND (parse_job_id IS NULL OR parse_job_id = $4)`,
      [quotaAllocationId, userId, resumeId, String(job.id)],
    )
  }

  return job
}

export async function cancelParseJobsByIds(jobIds = [], { logger = console } = {}) {
  const uniqueJobIds = [...new Set((jobIds || []).map((jobId) => String(jobId || '').trim()).filter(Boolean))]
  const summary = {
    requested: uniqueJobIds.length,
    removed: 0,
    skipped: 0,
    missing: 0,
    errors: 0,
  }

  for (const jobId of uniqueJobIds) {
    try {
      const queueJob = await parseQueue.getJob(jobId)
      if (!queueJob) {
        summary.missing += 1
        continue
      }

      const state = typeof queueJob.getState === 'function' ? await queueJob.getState() : null
      if (['completed', 'failed', 'active'].includes(String(state || '').toLowerCase())) {
        summary.skipped += 1
        continue
      }

      await queueJob.remove()
      summary.removed += 1
    } catch (error) {
      summary.errors += 1
      logger.warn?.(`[Queue] Failed to remove parse job ${jobId} during analysis cancellation:`, error)
    }
  }

  return summary
}

export async function initializeJobQueue() {
  await ensureParseJobsTable()
  console.log('[Queue] Resume parse queue initialized')
}
