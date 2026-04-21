import { pool } from '../db/client.js'
import { cacheJobResult, parseQueue } from '../services/jobQueue.js'
import { analyzeResumeWithConfiguredFallback } from '../services/aiResumeAnalysisService.js'
import { triggerWebhook } from '../services/webhookService.js'
import { normalizeProviderError } from './parseProviderError.js'

export function isTerminalJobFailure(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts || 1)
}

function normalizeUnavailableReason(reason) {
  const raw = String(reason || '').trim()
  return raw ? raw.slice(0, 180) : 'unknown'
}

let tokenUsageTableEnsured = false

async function ensureTokenUsageTable() {
  if (tokenUsageTableEnsured) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resume_analysis_token_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      parse_job_id TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      job_description_id UUID,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      model TEXT,
      usage_available BOOLEAN NOT NULL DEFAULT false,
      unavailable_reason TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      estimated_cost_usd NUMERIC(12, 6),
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)

  tokenUsageTableEnsured = true
}

async function persistTokenUsageMetric({
  resumeId,
  parseJobId,
  userId,
  jobDescriptionId,
  provider = 'anthropic',
  model = null,
  tokenUsage,
  metadata = {},
}) {
  await ensureTokenUsageTable()

  const usageAvailable = Boolean(tokenUsage?.usageAvailable)
  const unavailableReason = usageAvailable ? null : normalizeUnavailableReason(tokenUsage?.unavailableReason)

  await pool.query(
    `INSERT INTO resume_analysis_token_usage (
       resume_id,
       parse_job_id,
       user_id,
       job_description_id,
       provider,
       model,
       usage_available,
       unavailable_reason,
       input_tokens,
       output_tokens,
       total_tokens,
       estimated_cost_usd,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      resumeId,
      parseJobId ? String(parseJobId) : null,
      userId || null,
      jobDescriptionId || null,
      provider,
      model,
      usageAvailable,
      unavailableReason,
      usageAvailable ? Number(tokenUsage.inputTokens || 0) : null,
      usageAvailable ? Number(tokenUsage.outputTokens || 0) : null,
      usageAvailable ? Number(tokenUsage.totalTokens || 0) : null,
      usageAvailable ? Number(tokenUsage.estimatedCostUsd || 0) : null,
      JSON.stringify(metadata || {}),
    ],
  )
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

  let analysisResult
  let parseMethod = 'anthropic-primary'

  try {
    console.log('[Parse] Attempting AI analysis with primary/fallback keys...')
    const aiResponse = await analyzeResumeWithConfiguredFallback(fileBufferBase64, mimeType, filename)
    const aiResult = aiResponse?.result || {}
    const usageAttempts = Array.isArray(aiResponse?.attempts) && aiResponse.attempts.length > 0
      ? aiResponse.attempts
      : [{
          success: true,
          provider: aiResponse?.provider || 'anthropic-primary',
          model: aiResponse?.model || null,
          credentialLabel: aiResponse?.credentialLabel || 'primary',
          providerSource: aiResponse?.providerSource || 'unknown',
          tokenUsage: aiResponse?.tokenUsage || { usageAvailable: false, unavailableReason: 'provider_usage_missing' },
        }]

    for (const attempt of usageAttempts) {
      await persistTokenUsageMetric({
        resumeId,
        parseJobId: job.id,
        userId: job.data.userId,
        jobDescriptionId: job.data.jobDescriptionId || null,
        provider: attempt?.provider || 'anthropic',
        model: attempt?.model || null,
        tokenUsage: attempt?.tokenUsage || { usageAvailable: false, unavailableReason: 'provider_usage_missing' },
        metadata: {
          source: 'ai_primary_or_fallback_parse',
          credentialLabel: attempt?.credentialLabel || 'primary',
          providerSource: attempt?.providerSource || 'unknown',
          success: Boolean(attempt?.success),
          filename,
        },
      }).catch((persistError) => {
        console.warn('[Parse] Failed to persist token usage metadata:', persistError.message)
      })
    }

    console.log('[Parse] AI analysis successful')
    analysisResult = aiResult
    parseMethod = aiResponse?.provider || 'anthropic-primary'
  } catch (aiError) {
    const failedAttempts = Array.isArray(aiError?.attempts) ? aiError.attempts : []
    if (failedAttempts.length > 0) {
      for (const attempt of failedAttempts) {
        await persistTokenUsageMetric({
          resumeId,
          parseJobId: job.id,
          userId: job.data.userId,
          jobDescriptionId: job.data.jobDescriptionId || null,
          provider: attempt?.provider || 'anthropic',
          model: attempt?.model || null,
          tokenUsage: attempt?.tokenUsage || {
            usageAvailable: false,
            unavailableReason: `provider_request_failed:${normalizeUnavailableReason(aiError.message)}`,
          },
          metadata: {
            source: 'ai_primary_or_fallback_parse',
            credentialLabel: attempt?.credentialLabel || 'primary',
            providerSource: attempt?.providerSource || 'unknown',
            success: false,
            filename,
          },
        }).catch((persistError) => {
          console.warn('[Parse] Failed to persist missing token usage metadata:', persistError.message)
        })
      }
    } else {
      await persistTokenUsageMetric({
        resumeId,
        parseJobId: job.id,
        userId: job.data.userId,
        jobDescriptionId: job.data.jobDescriptionId || null,
        tokenUsage: {
          usageAvailable: false,
          unavailableReason: `provider_request_failed:${normalizeUnavailableReason(aiError.message)}`,
        },
        metadata: {
          source: 'ai_primary_or_fallback_parse',
          filename,
        },
      }).catch((persistError) => {
        console.warn('[Parse] Failed to persist missing token usage metadata:', persistError.message)
      })
    }

    throw aiError
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
    parserVersion: 'ai-only',
    analyzerUsed: 'AI',
    methodUsed: analysisResult?.methodUsed || parseMethod,
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
      const normalizedError = normalizeProviderError(error)
      const isTerminalFailure = isTerminalJobFailure(job)
      if (isTerminalFailure) {
        await pool.query(
          `UPDATE resumes
           SET parse_status = 'failed',
               parse_error = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [job.data.resumeId, normalizedError.normalizedMessage],
        )
      }

      await setJobState(job.id, {
        status: isTerminalFailure ? 'failed' : 'retrying',
        progress: isTerminalFailure ? 100 : Number(job.progress() || 0),
        error_message: normalizedError.normalizedMessage,
        attempts: job.attemptsMade + 1,
      })

      if (isTerminalFailure) {
        await cacheJobResult(String(job.id), {
          status: 'failed',
          progress: 100,
          result: null,
          error: normalizedError.normalizedMessage,
        })
      }

      throw error
    }
  })

  console.log('[Queue] Parse resume worker registered')
}
