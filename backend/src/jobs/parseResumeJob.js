import { Buffer } from 'buffer'
import { pool } from '../db/client.js'
import { cacheJobResult, parseQueue } from '../services/jobQueue.js'
import { runParseWithOcrFallback, shouldUseOcrFallback } from './ocrFallbackJob.js'
import { analyzeResumeWithClaude } from '../services/aiResumeAnalysisService.js'
import { estimateExtractableText, isLikelyScannedPdf } from '../services/ocrService.js'
import { triggerWebhook } from '../services/webhookService.js'

export function isTerminalJobFailure(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts || 1)
}

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

  let analysisResult
  const extraction = estimateExtractableText(fileBuffer)
  const scannedPdf = isLikelyScannedPdf({ mimeType, fileBuffer })

  try {
    console.log('[Parse] Attempting Claude analysis...')
    const aiResult = await analyzeResumeWithClaude(fileBufferBase64, mimeType, filename)
    const aiCandidates = Array.isArray(aiResult?.candidates) ? aiResult.candidates : []
    const aiConfidenceValues = aiCandidates.flatMap((candidate) =>
      Object.values(candidate?.confidenceScores || candidate?.confidence || {}),
    )
    const normalizedConfidenceValues = aiConfidenceValues
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => (value <= 1 ? value * 100 : value))
    const averageAiConfidence = normalizedConfidenceValues.length
      ? normalizedConfidenceValues.reduce((sum, value) => sum + value, 0) / normalizedConfidenceValues.length
      : 0

    const shouldRunFallback = shouldUseOcrFallback({
      scannedPdf,
      extractionLength: extraction.length,
      aiConfidence: averageAiConfidence,
    })

    if (shouldRunFallback) {
      console.warn('[Parse Job] AI parse quality is low, invoking OCR fallback safeguards')
      analysisResult = await runParseWithOcrFallback({
        filename,
        mimeType,
        fileSize,
        fileBuffer,
      })
    } else {
      console.log('[Parse] Claude analysis successful')
      analysisResult = aiResult
    }
  } catch (aiError) {
    console.warn('[Parse] Claude failed, falling back to OCR:', aiError.message)
    analysisResult = await runParseWithOcrFallback({
      filename,
      mimeType,
      fileSize,
      fileBuffer,
    })
  }

  const candidates = Array.isArray(analysisResult?.candidates)
    ? analysisResult.candidates.map((candidate, index) => ({
        id: candidate?.id || `${(resumeId || filename || 'resume').toString().toLowerCase()}-${index + 1}`,
        ...candidate,
        confidenceScores: candidate?.confidenceScores || candidate?.confidence || {},
      }))
    : []

  const parseResult = {
    filename,
    mimeType,
    fileSize,
    parserVersion: 'claude-resume-analysis-v1',
    methodUsed: analysisResult?.methodUsed || 'anthropic-claude',
    candidates,
    ...analysisResult,
    candidates,
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

  try {
    await triggerWebhook('parse.completed', {
      resumeId,
      userId: job.data.userId || null,
      candidates: parseResult?.candidates || [],
      jobDescriptionId: parseResult?.jobDescriptionId || null,
      matchScores: parseResult?.matchScores || null,
    })
  } catch (webhookError) {
    console.error('[Webhooks] Failed to trigger parse.completed webhook:', webhookError)
  }

  await job.progress(100)
  return parseResult
}

export function registerParseResumeJobProcessor() {
  parseQueue.process(async (job) => {
    try {
      return await runParse(job)
    } catch (error) {
      const isTerminalFailure = isTerminalJobFailure(job)
      if (isTerminalFailure) {
        await pool.query(
          `UPDATE resumes
           SET parse_status = 'failed',
               parse_error = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [job.data.resumeId, error.message || 'Unknown parse error'],
        )
      }

      await setJobState(job.id, {
        status: isTerminalFailure ? 'failed' : 'retrying',
        progress: isTerminalFailure ? 100 : Number(job.progress() || 0),
        error_message: error.message || 'Unknown parse error',
        attempts: job.attemptsMade + 1,
      })

      if (isTerminalFailure) {
        await cacheJobResult(String(job.id), {
          status: 'failed',
          progress: 100,
          result: null,
          error: error.message || 'Unknown parse error',
        })
      }

      throw error
    }
  })

  console.log('[Queue] Parse resume worker registered')
}
