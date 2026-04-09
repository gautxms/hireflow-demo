import { Buffer } from 'buffer'
import { pool } from '../db/client.js'
import { cacheJobResult, parseQueue } from '../services/jobQueue.js'
import { runParseWithOcrFallback } from './ocrFallbackJob.js'
import { sendEmail } from '../services/emailService.js'

async function setJobState(jobId, fields) {
  const columns = Object.keys(fields)
  const values = Object.values(fields)

  const setClause = columns.map((column, idx) => `${column} = $${idx + 2}`).join(', ')

  await pool.query(
    `UPDATE parse_jobs
     SET ${setClause}, updated_at = NOW()
     WHERE job_id = $1`,
    [String(jobId), ...values],
  )
}



async function sendParseCompleteNotification({ userId, resumeTitle, candidateCount }) {
  try {
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId])
    const userEmail = userResult.rows[0]?.email

    if (!userEmail) {
      return
    }

    await sendEmail({
      to: userEmail,
      template: 'parse-complete',
      data: {
        candidateCount,
        resumeTitle,
      },
    })
  } catch (error) {
    console.warn('[Queue] Failed to send parse complete notification email:', error.message)
  }
}

async function runParse(job) {
  const { resumeId, filename, mimeType, fileSize, fileBufferBase64 } = job.data
  const startedAt = Date.now()

  await setJobState(job.id, {
    status: 'processing',
    progress: 10,
    attempts: job.attemptsMade,
  })

  await job.progress(10)

  if (!fileBufferBase64) {
    throw new Error('Resume payload is empty')
  }

  await new Promise((resolve) => setTimeout(resolve, 400))
  await setJobState(job.id, { progress: 45 })
  await job.progress(45)

  await new Promise((resolve) => setTimeout(resolve, 400))
  await setJobState(job.id, { progress: 75 })
  await job.progress(75)

  const fileBuffer = Buffer.from(fileBufferBase64, 'base64')

  const fallbackResult = await runParseWithOcrFallback({
    filename,
    mimeType,
    fileSize,
    fileBuffer,
  })

  const parseResult = {
    filename,
    mimeType,
    fileSize,
    parserVersion: 'bull-async-v2-ocr-fallback',
    ...fallbackResult,
  }

  const parseDurationMs = Date.now() - startedAt

  await pool.query(
    `UPDATE resumes
     SET parse_status = 'complete',
         parse_result = $2::jsonb,
         parse_error = NULL,
         parse_duration_ms = $3,
         updated_at = NOW(),
         raw_text = COALESCE(raw_text, '')
     WHERE id = $1`,
    [resumeId, JSON.stringify(parseResult), parseDurationMs],
  )

  await setJobState(job.id, {
    status: 'complete',
    progress: 100,
    result: JSON.stringify(parseResult),
    error_message: null,
    attempts: job.attemptsMade + 1,
  })

  await cacheJobResult(String(job.id), {
    status: 'complete',
    progress: 100,
    result: parseResult,
  })

  const candidateCount = Array.isArray(parseResult.candidates) ? parseResult.candidates.length : 0
  await sendParseCompleteNotification({
    userId: job.data.userId,
    resumeTitle: filename,
    candidateCount,
  })

  await job.progress(100)
  return parseResult
}

export function registerParseResumeJobProcessor() {
  parseQueue.process(async (job) => {
    try {
      return await runParse(job)
    } catch (error) {
      await pool.query(
        `UPDATE resumes
         SET parse_status = 'failed',
             parse_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [job.data.resumeId, error.message || 'Unknown parse error'],
      )

      await setJobState(job.id, {
        status: 'failed',
        progress: 100,
        error_message: error.message || 'Unknown parse error',
        attempts: job.attemptsMade + 1,
      })

      await cacheJobResult(String(job.id), {
        status: 'failed',
        progress: 100,
        result: null,
        error: error.message || 'Unknown parse error',
      })

      throw error
    }
  })

  console.log('[Queue] Parse resume worker registered')
}
