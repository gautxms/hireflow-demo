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

function normalizeString(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeSkills(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeString(entry)).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => normalizeString(entry)).filter(Boolean)
  }
  return []
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => normalizeString(entry)).filter(Boolean)
}

function normalizeStructuredSkills(skills) {
  if (Array.isArray(skills) || typeof skills === 'string') {
    return {
      tools_and_platforms: normalizeSkills(skills),
      methodologies: [],
      domain_expertise: [],
      soft_skills: [],
    }
  }

  if (!skills || typeof skills !== 'object') {
    return {
      tools_and_platforms: [],
      methodologies: [],
      domain_expertise: [],
      soft_skills: [],
    }
  }

  return {
    tools_and_platforms: normalizeStringArray(skills.tools_and_platforms),
    methodologies: normalizeStringArray(skills.methodologies),
    domain_expertise: normalizeStringArray(skills.domain_expertise),
    soft_skills: normalizeStringArray(skills.soft_skills),
  }
}

function flattenStructuredSkills(skillsStructured) {
  const flattened = [
    ...(skillsStructured.tools_and_platforms || []),
    ...(skillsStructured.methodologies || []),
    ...(skillsStructured.domain_expertise || []),
    ...(skillsStructured.soft_skills || []),
  ]

  return [...new Set(flattened.map((entry) => normalizeString(entry)).filter(Boolean))]
}

function getPreferredJobDescriptionText(row = {}) {
  const candidates = [
    row.file_text,
    row.extracted_text,
    row.parsed_text,
    row.content_text,
    row.raw_text,
  ]
  return candidates.map((value) => normalizeString(value)).find(Boolean) || null
}

export function buildJobDescriptionContext(row) {
  if (!row) {
    return {
      hasContext: false,
      source: 'none',
      missingReason: 'job_description_missing',
    }
  }

  const fileText = getPreferredJobDescriptionText(row)
  const hasFile = Boolean(normalizeString(row.file_url))
  const skills = normalizeSkills(row.skills)
  const normalized = {
    hasContext: true,
    jobDescriptionId: row.id || null,
    title: normalizeString(row.title),
    description: normalizeString(row.description),
    requirements: normalizeString(row.requirements),
    skills,
    experienceYears: normalizeNullableNumber(row.experience_years),
    location: normalizeString(row.location),
    salaryMin: normalizeNullableNumber(row.salary_min),
    salaryMax: normalizeNullableNumber(row.salary_max),
    salaryCurrency: normalizeString(row.salary_currency) || 'USD',
    fileUrl: normalizeString(row.file_url),
    fileText,
    source: fileText ? 'file_text' : hasFile ? 'manual_fields_file_fallback' : 'manual_fields',
    fileTextAvailable: Boolean(fileText),
  }

  const hasManualContext = Boolean(
    normalized.title
      || normalized.description
      || normalized.requirements
      || normalized.skills.length > 0
      || normalized.experienceYears !== null,
  )

  if (!normalized.fileText && !hasManualContext) {
    return {
      hasContext: false,
      jobDescriptionId: row.id || null,
      source: hasFile ? 'file_only_no_text' : 'none',
      missingReason: hasFile ? 'job_description_file_text_unavailable' : 'job_description_empty',
    }
  }

  return normalized
}

async function fetchJobDescriptionContext({ userId, jobDescriptionId }) {
  if (!userId || !jobDescriptionId) {
    return {
      hasContext: false,
      source: 'none',
      missingReason: 'job_description_missing',
    }
  }

  const jdResult = await pool.query(
    `SELECT *
     FROM job_descriptions
     WHERE id = $1
       AND user_id = $2
       AND status <> 'archived'
     LIMIT 1`,
    [jobDescriptionId, userId],
  )

  if (!jdResult.rows[0]) {
    return {
      hasContext: false,
      jobDescriptionId,
      source: 'none',
      missingReason: 'job_description_not_found_or_archived',
    }
  }

  return buildJobDescriptionContext(jdResult.rows[0])
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

export function applyJobDescriptionScoringMode(candidates = [], jobDescriptionContext = null) {
  if (jobDescriptionContext?.hasContext) {
    return candidates
  }

  return candidates.map((candidate) => ({
    ...candidate,
    matchScore: null,
    matchScoreReason: 'job_description_missing',
    fit_assessment: {
      ...(candidate?.fit_assessment && typeof candidate.fit_assessment === 'object' ? candidate.fit_assessment : {}),
      has_job_description_context: false,
      overall_fit_score: null,
      skill_match_score: null,
      experience_match_score: null,
      education_match_score: null,
      location_match_score: null,
      notes: Array.from(new Set([
        ...(Array.isArray(candidate?.fit_assessment?.notes) ? candidate.fit_assessment.notes : []),
        'job_description_missing',
      ])),
    },
  }))
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
  const jobDescriptionContext = await fetchJobDescriptionContext({
    userId: job.data.userId,
    jobDescriptionId: job.data.jobDescriptionId || null,
  })

  try {
    console.log('[Parse] Attempting AI analysis with primary/fallback keys...')
    const aiResponse = await analyzeResumeWithConfiguredFallback(fileBufferBase64, mimeType, filename, {
      jobDescriptionContext,
    })
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
          failureCategory: attempt?.failureCategory || null,
          failureReason: attempt?.failureReason || null,
          promptVersion: Number(attempt?.promptVersion || 1),
          promptIsDefaultFallback: Boolean(attempt?.promptIsDefaultFallback),
          success: Boolean(attempt?.success),
          filename,
          jobDescriptionContextUsed: Boolean(jobDescriptionContext?.hasContext),
          jobDescriptionContextSource: jobDescriptionContext?.source || 'none',
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
            failureCategory: attempt?.failureCategory || null,
            failureReason: attempt?.failureReason || null,
            promptVersion: Number(attempt?.promptVersion || 1),
            promptIsDefaultFallback: Boolean(attempt?.promptIsDefaultFallback),
            success: false,
            filename,
            jobDescriptionContextUsed: Boolean(jobDescriptionContext?.hasContext),
            jobDescriptionContextSource: jobDescriptionContext?.source || 'none',
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
          promptVersion: 1,
          promptIsDefaultFallback: true,
          filename,
          jobDescriptionContextUsed: Boolean(jobDescriptionContext?.hasContext),
          jobDescriptionContextSource: jobDescriptionContext?.source || 'none',
        },
      }).catch((persistError) => {
        console.warn('[Parse] Failed to persist missing token usage metadata:', persistError.message)
      })
    }

    throw aiError
  }

  const candidates = Array.isArray(analysisResult?.candidates)
    ? analysisResult.candidates.map((candidate, index) => {
        const skillsStructured = normalizeStructuredSkills(candidate?.skills)
        const fallbackSkills = normalizeSkills(candidate?.skills)
        const flattenedSkills = flattenStructuredSkills(skillsStructured)
        const resolvedSkillsFlat = flattenedSkills.length > 0 ? flattenedSkills : fallbackSkills
        return {
          id: candidate?.id || `${(resumeId || filename || 'resume').toString().toLowerCase()}-${index + 1}`,
          ...candidate,
          years_experience: normalizeNullableNumber(candidate?.years_experience),
          profile_score: normalizeNullableNumber(candidate?.profile_score),
          strengths: normalizeStringArray(candidate?.strengths),
          considerations: normalizeStringArray(candidate?.considerations),
          seniority_level: normalizeString(candidate?.seniority_level),
          tags: normalizeStringArray(candidate?.tags),
          top_skills: normalizeStringArray(candidate?.top_skills).slice(0, 5),
          skills_structured: skillsStructured,
          skills: skillsStructured,
          skills_flat: resolvedSkillsFlat,
          confidenceScores: candidate?.confidenceScores || candidate?.confidence || {},
        }
      })
    : []
  const normalizedCandidates = applyJobDescriptionScoringMode(candidates, jobDescriptionContext)

  const parseResult = {
    filename,
    mimeType,
    fileSize,
    parserVersion: 'ai-only',
    analyzerUsed: 'AI',
    methodUsed: analysisResult?.methodUsed || parseMethod,
    ...analysisResult,
    jobDescriptionId: job.data.jobDescriptionId || null,
    jobDescriptionContextUsed: Boolean(jobDescriptionContext?.hasContext),
    jobDescriptionContextSource: jobDescriptionContext?.source || 'none',
    jobDescriptionContextMissingReason: jobDescriptionContext?.hasContext
      ? null
      : (jobDescriptionContext?.missingReason || 'job_description_missing'),
    candidates: normalizedCandidates,
  }

  const parseDurationMs = Date.now() - startedAt

  const primaryCandidate = normalizedCandidates[0] || null
  await pool.query(
    `UPDATE resumes
     SET parse_status = 'complete',
         parse_result = $2::jsonb,
         years_experience = $3,
         profile_score = $4,
         strengths = $5::jsonb,
         considerations = $6::jsonb,
         seniority_level = $7,
         tags = $8::jsonb,
         top_skills = $9::jsonb,
         skills_structured = $10::jsonb,
         skills = $11::jsonb,
         parse_error = NULL,
         parse_duration_ms = $12,
         updated_at = NOW(),
         raw_text = COALESCE(raw_text, '')
     WHERE id = $1`,
    [
      resumeId,
      JSON.stringify(parseResult),
      normalizeNullableNumber(primaryCandidate?.years_experience),
      normalizeNullableNumber(primaryCandidate?.profile_score),
      JSON.stringify(primaryCandidate?.strengths || []),
      JSON.stringify(primaryCandidate?.considerations || []),
      normalizeString(primaryCandidate?.seniority_level),
      JSON.stringify(primaryCandidate?.tags || []),
      JSON.stringify(primaryCandidate?.top_skills || []),
      JSON.stringify(primaryCandidate?.skills_structured || {
        tools_and_platforms: [],
        methodologies: [],
        domain_expertise: [],
        soft_skills: [],
      }),
      JSON.stringify(primaryCandidate?.skills_flat || []),
      parseDurationMs,
    ],
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
