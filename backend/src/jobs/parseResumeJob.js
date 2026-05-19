import { pool } from '../db/client.js'
import { cacheJobResult, parseQueue } from '../services/jobQueue.js'
import { analyzeResumeWithConfiguredFallback } from '../services/aiResumeAnalysisService.js'
import { triggerWebhook } from '../services/webhookService.js'
import { CANDIDATE_PROFILE_SCHEMA_VERSION, upsertCandidateProfile } from '../services/candidateProfilesService.js'
import { normalizeProviderError } from './parseProviderError.js'
import { resolveCanonicalCandidateIdentity } from '../utils/candidateIdentity.js'
import { getCandidateValidationFailureReasons, isCandidateExtractionValid, isCandidateValidForScoredOutcome, isFailureNarrativeCandidate, isFailurePlaceholderCandidate } from '../utils/candidateValidation.js'
import { runParseWithOcrFallback } from './ocrFallbackJob.js'
import { trackEvent } from '../services/analytics.js'
import { evaluateOcrOutcome, runResumePreflight } from './resumePreflight.js'
import { buildLocalPostAiFailureNormalizedPayload, isLocalPostAiValidationFailure } from './parseFailureMapping.js'

const MIN_EXTRACTED_TEXT_LENGTH = 80
const PLACEHOLDER_RETRY_MIN_TEXT_LENGTH = 1000
const PLACEHOLDER_RETRY_PROMPT_SUFFIX = [
  'Critical output guardrail:',
  '- The resume text is substantial. If extracted text exists, do best-effort structured extraction using the existing schema.',
  '- Do not return failure placeholders or parser-failure narratives when extracted text is present.',
  '- Do not return "Unknown Candidate" or unreadable/corrupt-document narratives unless extracted text is genuinely empty.',
  '- For uncertain optional fields, use null/empty values instead of failure templates or generic corruption narratives.',
  '- Do not use phrases like "unable to parse", "cannot extract", or "no resume content found" in candidate fields when text exists.',
].join('\n')
const RESUME_SIGNAL_PATTERN = /\b(experience|education|skills?|projects?|employment|certifications?|summary)\b/i

export function isTerminalJobFailure(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts || 1)
}

export { isFailurePlaceholderCandidate }

function mapParseErrorCode(errorCode) {
  const normalized = String(errorCode || '').trim().toLowerCase()
  if (normalized.startsWith('parse_failed::')) return normalized.slice(0, 120)
  if (normalized.startsWith('scoring_failed::')) return normalized.slice(0, 120)
  if (normalized === 'extraction_failed') return 'extraction_failed'
  if (normalized === 'encrypted_or_password_protected_pdf') return 'encrypted_or_password_protected_pdf'
  if (normalized === 'corrupt_or_unreadable') return 'corrupt_or_unreadable'
  if (normalized === 'unsupported_encoding_or_format') return 'unsupported_encoding_or_format'
  if (normalized === 'image_only_low_ocr') return 'image_only_low_ocr'
  if (normalized === 'scoring_failed' || normalized.startsWith('scoring_failed::')) return normalized.startsWith('scoring_failed::') ? normalized.slice(0, 120) : 'scoring_failed'
  if (
    normalized === 'response_truncated_error'
    || normalized === 'response_format_error'
    || normalized === 'invalid_request_error'
    || normalized === 'not_found_error'
    || normalized === 'auth_error'
    || normalized === 'billing_quota_error'
    || normalized === 'rate_limit_error'
    || normalized === 'timeout_error'
    || normalized === 'network_error'
    || normalized === 'unknown_error'
  ) {
    return 'parse_failed'
  }
  return 'parse_failed'
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

function clampString(value, maxLength = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function clampStringArray(value, maxItems = 5, maxItemLength = 160) {
  return normalizeStringArray(value)
    .map((entry) => clampString(entry, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems)
}

function buildExtractionDiagnosticsSummary({
  extractionResult,
  hasUsableExtractedText,
}) {
  const stageDiagnostics = extractionResult?.stageDiagnostics || {}
  const pdfStage = stageDiagnostics.pdf_text || {}
  const ocrStage = stageDiagnostics.ocr || {}
  const visionStage = stageDiagnostics.direct_pdf_vision || {}
  const finalMethod = extractionResult?.methodUsed || 'failed'

  const pdfTextExtractedTextLength = Number(pdfStage.extractedTextLength || 0)
  const ocrExtractedTextLength = Number(ocrStage.extractedTextLength || 0)
  const ocrConfidence = Number(ocrStage.confidence || 0)

  const pdfTextUsable = (
    (Boolean(pdfStage.attempted) && pdfStage.status === 'success' && pdfTextExtractedTextLength >= MIN_EXTRACTED_TEXT_LENGTH)
    || pdfStage.reason === 'text_quality_meets_threshold'
    || (visionStage.reason === 'pdf_text_usable')
    || (hasUsableExtractedText && finalMethod === 'pdf_text')
  )
  const ocrUsable = (
    (Boolean(ocrStage.attempted) && ocrExtractedTextLength >= MIN_EXTRACTED_TEXT_LENGTH && ocrConfidence >= 55)
    || ocrStage.reason === 'ocr_confidence_meets_threshold'
    || ocrStage.reason === 'selected_for_final_text'
    || (hasUsableExtractedText && finalMethod === 'ocr')
  )

  const pdfTextReason = pdfTextUsable
    ? 'text_quality_meets_threshold'
    : (pdfStage.attempted
        ? 'text_quality_below_threshold'
        : 'pdf_text_not_attempted')

  const ocrReason = !ocrStage.attempted
    ? 'ocr_not_required'
    : (ocrUsable ? 'ocr_confidence_meets_threshold' : 'ocr_confidence_below_threshold')

  let directPdfVisionReason = 'vision_not_required'
  if (!visionStage.attempted && visionStage.status === 'skipped') {
    if (visionStage.reason === 'unsupported_model_input_mode') {
      directPdfVisionReason = 'model_capability_unsupported'
    } else if (visionStage.reason === 'capability_resolution_failed') {
      directPdfVisionReason = 'model_capability_resolution_failed'
    } else {
      directPdfVisionReason = 'vision_not_required'
    }
  }
  if (visionStage.attempted) {
    directPdfVisionReason = visionStage.status === 'success' ? 'vision_parse_succeeded' : 'vision_parse_failed'
  }

  const finalExtractionMethod = ['pdf_text', 'ocr', 'direct_pdf_vision'].includes(finalMethod)
    ? finalMethod
    : 'failed'

  return {
    pdf_text: {
      attempted: Boolean(pdfStage.attempted),
      usability: pdfTextUsable ? 'usable' : 'unusable',
      reason: pdfTextReason,
    },
    ocr: {
      status: ocrStage.attempted ? 'attempted' : 'skipped',
      usability: ocrUsable ? 'usable' : 'unusable',
      reason: ocrReason,
    },
    direct_pdf_vision: {
      status: visionStage.attempted ? 'attempted' : 'skipped',
      outcome: finalMethod === 'direct_pdf_vision' ? 'success' : 'failure',
      reason: directPdfVisionReason,
    },
    final_extraction_method: finalExtractionMethod,
  }
}



function normalizeMetricTag(value, fallback = 'unknown') {
  const normalized = String(value || '').trim()
  return normalized ? normalized.slice(0, 120) : fallback
}

async function emitParseValidationReasonMetrics({
  userId,
  validationFailureCounters,
  tags,
}) {
  const entries = Object.entries(validationFailureCounters || {}).filter(([reason, count]) => reason.startsWith('failure_') && Number(count) > 0)
  if (entries.length === 0) return

  for (const [reason, count] of entries) {
    const eventMetadata = {
      metric: 'parse_validation_failure_reason_total',
      reason,
      count: Number(count),
      model: normalizeMetricTag(tags?.model),
      provider: normalizeMetricTag(tags?.provider),
      promptVersion: Number(tags?.promptVersion || 1),
      mimeType: normalizeMetricTag(tags?.mimeType),
      extractionMethod: normalizeMetricTag(tags?.extractionMethod),
    }
    console.log('[ParseValidationMetrics] parse_validation_failure_reason_total', eventMetadata)
    await trackEvent({
      userId: userId || null,
      eventType: 'parse_validation_failure_reason',
      metadata: eventMetadata,
    })
  }
}
function hasMeaningfulResumeSignals(text = '') {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  return normalized.length >= MIN_EXTRACTED_TEXT_LENGTH && RESUME_SIGNAL_PATTERN.test(normalized)
}

export function shouldFailBeforeAi({ hasUsableExtractedText }) {
  return !hasUsableExtractedText
}

export function shouldTriggerPlaceholderRetry({ candidates, extractedTextLength }) {
  if (!Array.isArray(candidates) || candidates.length === 0) return false
  if (!Number.isFinite(Number(extractedTextLength)) || Number(extractedTextLength) < PLACEHOLDER_RETRY_MIN_TEXT_LENGTH) return false
  return candidates.some((candidate) => isFailurePlaceholderCandidate(candidate) || isFailureNarrativeCandidate(candidate))
}

export function buildExtractionSelectionDiagnostics({ extractionResult, ocrOutcome, hasUsableExtractedText }) {
  const stageDiagnostics = extractionResult?.stageDiagnostics || {}
  const pdfStage = stageDiagnostics.pdf_text || {}
  const ocrStage = stageDiagnostics.ocr || {}
  const visionStage = stageDiagnostics.direct_pdf_vision || {}
  const extractedRawText = String(extractionResult?.rawText || '').trim()

  const pdfTextAvailable = Number(pdfStage.extractedTextLength || 0) > 0
  const pdfTextLength = Number(pdfStage.extractedTextLength || 0)
  const ocrTextLength = Number(ocrStage.extractedTextLength || 0)
  const ocrConfidence = Number(extractionResult?.ocrConfidence ?? ocrStage.confidence ?? 0)
  const selectedExtractionMethod = extractionResult?.methodUsed || 'failed'
  const hasResumeSignals = hasMeaningfulResumeSignals(extractedRawText)
  const pdfTextQuality = hasResumeSignals
    ? 'usable_resume_signals'
    : (hasUsableExtractedText ? 'missing_resume_signals' : 'unusable')
  const ocrUsable = ocrTextLength >= MIN_EXTRACTED_TEXT_LENGTH && ocrConfidence >= 55

  const skippedReasons = []
  if (ocrOutcome) skippedReasons.push('ocr_confidence_below_threshold')
  if (!pdfTextAvailable) skippedReasons.push('pdf_text_unavailable')
  if (visionStage.status === 'skipped' && visionStage.reason) skippedReasons.push(`direct_pdf_vision_${visionStage.reason}`)

  return {
    pdfTextAvailable,
    pdfTextLength,
    pdfTextQuality,
    ocrAttempted: Boolean(ocrStage.attempted),
    ocrConfidence,
    ocrTextLength,
    ocrUsable,
    selectedExtractionMethod,
    hasResumeSignals,
    skippedReasons,
    terminalReason: null,
    aiCalled: false,
  }
}

function normalizeExperienceConfidence(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['high', 'medium', 'low', 'unknown'].includes(normalized) ? normalized : 'unknown'
}

function normalizeExperienceSource(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['resume', 'ai_inferred', 'unknown'].includes(normalized) ? normalized : 'unknown'
}

function normalizeIntegritySeverity(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : 'low'
}

function normalizeResumeIntegrityFlags(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') return null
    const issueType = normalizeString(entry.issueType ?? entry.issue_type) || 'general_parsing_concern'
    return {
      issueType,
      severity: normalizeIntegritySeverity(entry.severity),
      label: clampString(entry.label || 'Potential issue', 120),
      evidence: clampString(entry.evidence || 'Needs recruiter review', 240),
      recruiterAction: clampString(entry.recruiterAction || entry.recruiter_action || 'Needs recruiter review', 180),
      confidence: Math.max(0, Math.min(1, Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence) : 0.5)),
      source: clampString(entry.source || 'ai_assisted', 40),
    }
  }).filter(Boolean).slice(0, 8)
}

function normalizeEducationEntry(entry) {
  if (typeof entry === 'string') {
    const rawText = normalizeString(entry)
    return rawText ? {
      degree: null,
      field: null,
      institution: null,
      startDate: null,
      endDate: null,
      grade: null,
      gradeType: null,
      rawText,
    } : null
  }

  if (!entry || typeof entry !== 'object') return null

  const degree = normalizeString(entry.degree ?? entry.qualification ?? entry.program)
  const field = normalizeString(entry.field ?? entry.major ?? entry.specialization)
  const institution = normalizeString(entry.institution ?? entry.school ?? entry.university)
  const startDate = normalizeString(entry.startDate ?? entry.start_date ?? entry.from)
  const endDate = normalizeString(entry.endDate ?? entry.end_date ?? entry.to)
  const grade = normalizeString(entry.grade ?? entry.gpa ?? entry.score)
  const gradeType = normalizeString(entry.gradeType ?? entry.grade_type)
  const rawText = normalizeString(entry.rawText ?? entry.text ?? entry.value)

  if (!degree && !field && !institution && !startDate && !endDate && !grade && !gradeType && !rawText) {
    return null
  }

  return { degree, field, institution, startDate, endDate, grade, gradeType, rawText }
}

function normalizeEducation(education, candidate = {}) {
  const rawEducation = education ?? candidate?.highest_education ?? candidate?.highestEducation ?? candidate?.degree ?? null
  const normalizedArray = Array.isArray(rawEducation)
    ? rawEducation.map((entry) => normalizeEducationEntry(entry)).filter(Boolean)
    : [normalizeEducationEntry(rawEducation)].filter(Boolean)

  const legacyEducation = typeof rawEducation === 'string'
    ? clampString(rawEducation, 300)
    : normalizedArray
      .map((entry) => [entry.degree, entry.institution].filter(Boolean).join(', '))
      .filter(Boolean)
      .join(' | ')

  return {
    canonical: normalizedArray,
    legacyEducation: legacyEducation || null,
    highestEducation: normalizeString(candidate?.highestEducation ?? candidate?.highest_education) || (normalizedArray[0]?.degree || null),
    degree: normalizeString(candidate?.degree) || (normalizedArray[0]?.degree || null),
  }
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
  stage = 'parse',
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
      JSON.stringify({ ...((metadata && typeof metadata === "object") ? metadata : {}), stage }),
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


function buildPreflightFailureParseResult({ filename, mimeType, fileSize, preflight }) {
  return {
    filename,
    mimeType,
    fileSize,
    parserVersion: 'ai-only',
    analyzerUsed: 'AI',
    parseOutcome: preflight.parseOutcome || 'failed',
    failureCategory: preflight.failureCategory || 'parse_failed',
    failureMessageUserSafe: preflight.failureMessageUserSafe || 'Unable to parse this resume file.',
    candidates: [],
    parseMeta: {
      parseStatus: preflight.parseOutcome || 'failed',
      scoringStatus: 'skipped_preflight_unrecoverable',
      preflight,
    },
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

  let analysisResult
  let parseMethod = 'anthropic-primary'
  let parseProvider = null
  let parseModel = null
  let parseMaxOutputTokens = null
  const fileBuffer = Buffer.from(String(fileBufferBase64 || ''), 'base64')
  const preflight = runResumePreflight({ mimeType, fileBuffer })
  if (!preflight.ok && preflight.unrecoverable) {
    const latestPromptVersion = usageAttempts.length > 0
    ? Number(usageAttempts[usageAttempts.length - 1]?.promptVersion || 1)
    : 1

  await emitParseValidationReasonMetrics({
    userId: job.data.userId,
    validationFailureCounters,
    tags: {
      model: parseModel || analysisResult?.model || null,
      provider: parseProvider || analysisResult?.provider || parseMethod,
      promptVersion: latestPromptVersion,
      mimeType,
      extractionMethod: extractionResult?.methodUsed || 'failed',
    },
  })

  const parseDurationMs = Date.now() - startedAt
    const parseResult = buildPreflightFailureParseResult({ filename, mimeType, fileSize, preflight })
    await pool.query(
      `UPDATE resumes
       SET parse_status = 'failed',
           parse_result = $2::jsonb,
           parse_error = $3,
           parse_error_code = $4,
           parse_duration_ms = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [resumeId, JSON.stringify(parseResult), preflight.failureMessageUserSafe, preflight.failureCategory, parseDurationMs],
    )
    await setJobState(job.id, {
      status: 'failed',
      progress: 100,
      result: JSON.stringify(parseResult),
      error_message: preflight.failureMessageUserSafe,
      attempts: job.attemptsMade + 1,
    })
    console.log('[Parse][StageUsage]', { resumeId, parseJobId: job.id, failureCategory: preflight.failureCategory || "unknown", stageUsage: { parse: { attempted: true }, ocr: { attempted: Boolean(preflight.routeToOcr), status: "skipped_preflight" }, score: { attempted: false, skipped: true, skipReason: "preflight_hard_fail" }, fallback: { attempted: false } } })
    return parseResult
  }

  const extractionResult = await runParseWithOcrFallback({
    filename,
    mimeType,
    fileSize: Number(fileSize || 0),
    fileBuffer,
    forceOcr: Boolean(preflight.routeToOcr),
    preflightLowQuality: Boolean(preflight?.textQuality?.lowExtractableTextLikely || preflight?.textQuality?.lowReadableQualityLikely),
  })
  const extractedRawText = String(extractionResult?.rawText || '').trim()
  const hasUsableExtractedText = extractedRawText.length >= MIN_EXTRACTED_TEXT_LENGTH
  const ocrOutcome = preflight.routeToOcr
    ? evaluateOcrOutcome({
        ocrConfidence: extractionResult?.ocrConfidence,
        preflightDiagnostics: preflight?.diagnostics,
        extractedTextLength: extractedRawText.length,
      })
    : null
  const preflightLowQualityLikely = Boolean(preflight?.textQuality?.lowExtractableTextLikely || preflight?.textQuality?.lowReadableQualityLikely)
  const forcedExtractionFailure = preflight.routeToOcr
    && preflightLowQualityLikely
    && extractionResult?.methodUsed !== 'ocr'
    && !hasUsableExtractedText
    ? {
        failureCategory: 'extraction_failed',
        failureMessageUserSafe: 'PDF text extraction quality was too low, and OCR fallback was unavailable or did not improve extraction.',
      }
    : null
  const jobDescriptionContext = await fetchJobDescriptionContext({
    userId: job.data.userId,
    jobDescriptionId: job.data.jobDescriptionId || null,
  })
  let usageAttempts = []
  let placeholderRetryAttempted = false
  let placeholderRetrySucceeded = false
  let placeholderRetryReason = null
  const selectionDiagnostics = buildExtractionSelectionDiagnostics({
    extractionResult,
    ocrOutcome,
    hasUsableExtractedText,
  })

  try {
    if (forcedExtractionFailure) {
      const error = new Error(`${forcedExtractionFailure.failureCategory}::${forcedExtractionFailure.failureMessageUserSafe}`)
      error.preflightFailure = forcedExtractionFailure
      throw error
    }
    if (shouldFailBeforeAi({ hasUsableExtractedText })) {
      selectionDiagnostics.terminalReason = 'no_usable_text_after_pdf_ocr_and_direct_vision'
      throw new Error('extraction_failed::Unable to extract enough resume text for AI parsing after OCR fallback.')
    }
    if (!hasMeaningfulResumeSignals(extractedRawText)) {
      selectionDiagnostics.terminalReason = 'warning_missing_resume_signals'
    }
    console.log('[Parse] Attempting AI analysis with primary/fallback keys', {
      jobId: job.id,
      resumeId,
      jobDescriptionId: job.data.jobDescriptionId || null,
    })
    const aiResponse = await analyzeResumeWithConfiguredFallback(
      Buffer.from(extractedRawText, 'utf8').toString('base64'),
      'text/plain',
      filename,
      {
      jobDescriptionContext,
      resumeId,
      jobId: job.id,
      },
    )
    const aiResult = aiResponse?.result || {}
    usageAttempts = Array.isArray(aiResponse?.attempts) && aiResponse.attempts.length > 0
      ? aiResponse.attempts
      : [{
          success: true,
          provider: aiResponse?.provider || 'anthropic-primary',
          model: aiResponse?.model || null,
          credentialLabel: aiResponse?.credentialLabel || 'primary',
          providerSource: aiResponse?.providerSource || 'unknown',
          tokenUsage: aiResponse?.tokenUsage || { usageAvailable: false, unavailableReason: 'provider_usage_missing' },
        }]

    const parseAttemptStage = (attempt) => {
      const providerSource = String(attempt?.providerSource || '').toLowerCase()
      const credentialLabel = String(attempt?.credentialLabel || '').toLowerCase()
      if (providerSource === 'fallback' || credentialLabel === 'fallback') return 'fallback'
      return 'parse'
    }

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
        stage: parseAttemptStage(attempt),
      }).catch((persistError) => {
        console.warn('[Parse] Failed to persist token usage metadata:', persistError.message)
      })
    }

    console.log('[Parse] AI analysis successful', {
      jobId: job.id,
      resumeId,
      provider: aiResponse?.provider || null,
      model: aiResponse?.model || null,
    })
    analysisResult = aiResult
    selectionDiagnostics.aiCalled = true
    parseMethod = aiResponse?.provider || 'anthropic-primary'
    parseProvider = aiResponse?.provider || null
    parseModel = aiResponse?.model || null
    parseMaxOutputTokens = Number(aiResponse?.maxOutputTokens || aiResult?.maxOutputTokens || 0) || null

    if (shouldTriggerPlaceholderRetry({ candidates: aiResult?.candidates, extractedTextLength: extractedRawText.length })) {
      placeholderRetryAttempted = true
      placeholderRetryReason = 'placeholder_detected_with_substantial_extracted_text'
      const retryResponse = await analyzeResumeWithConfiguredFallback(
        Buffer.from(extractedRawText, 'utf8').toString('base64'),
        'text/plain',
        filename,
        {
          jobDescriptionContext,
          resumeId,
          jobId: job.id,
          promptHardeningSuffix: PLACEHOLDER_RETRY_PROMPT_SUFFIX,
        },
      )
      const retryResult = retryResponse?.result || {}
      const retryAttempts = Array.isArray(retryResponse?.attempts) ? retryResponse.attempts : []
      usageAttempts = [...usageAttempts, ...retryAttempts]
      placeholderRetrySucceeded = !shouldTriggerPlaceholderRetry({ candidates: retryResult?.candidates, extractedTextLength: extractedRawText.length })
      analysisResult = retryResult
      parseMethod = retryResponse?.provider || parseMethod
      parseProvider = retryResponse?.provider || parseProvider
      parseModel = retryResponse?.model || parseModel
      parseMaxOutputTokens = Number(retryResponse?.maxOutputTokens || retryResult?.maxOutputTokens || parseMaxOutputTokens || 0) || parseMaxOutputTokens
    }
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
          stage: parseAttemptStage(attempt),
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
        stage: 'fallback',
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
        const identity = resolveCanonicalCandidateIdentity(
          candidate,
          `${(resumeId || filename || 'resume').toString().toLowerCase()}-${index + 1}`,
        )
        const normalizedEducation = normalizeEducation(candidate?.education, candidate)
        const resumeIntegrityFlags = normalizeResumeIntegrityFlags(candidate?.resumeIntegrityFlags)
        return {
          id: identity.id,
          candidateId: identity.candidateId,
          resumeId: identity.resumeId || String(resumeId || ''),
          ...candidate,
          summary: clampString(candidate?.summary, 400),
          years_experience: normalizeNullableNumber(candidate?.years_experience),
          totalExperienceYears: normalizeNullableNumber(candidate?.totalExperienceYears ?? candidate?.years_experience),
          relevantExperienceYears: normalizeNullableNumber(candidate?.relevantExperienceYears),
          experienceLabel: normalizeString(candidate?.experienceLabel),
          experienceConfidence: normalizeExperienceConfidence(candidate?.experienceConfidence),
          experienceEvidence: clampStringArray(candidate?.experienceEvidence, 3, 180),
          experienceSource: normalizeExperienceSource(candidate?.experienceSource),
          profile_score: normalizeNullableNumber(candidate?.profile_score),
          strengths: clampStringArray(candidate?.strengths, 5, 160),
          considerations: clampStringArray(candidate?.considerations, 5, 160),
          seniority_level: normalizeString(candidate?.seniority_level),
          tags: normalizeStringArray(candidate?.tags),
          top_skills: normalizeStringArray(candidate?.top_skills).slice(0, 15),
          skills_structured: skillsStructured,
          skills: skillsStructured,
          skills_flat: normalizeStringArray(resolvedSkillsFlat).slice(0, 25),
          confidenceScores: candidate?.confidenceScores || candidate?.confidence || {},
          education: normalizedEducation.canonical,
          highestEducation: normalizedEducation.highestEducation,
          highest_education: normalizedEducation.highestEducation,
          degree: normalizedEducation.degree,
          legacyEducation: normalizedEducation.legacyEducation,
          ...(resumeIntegrityFlags.length > 0 ? { resumeIntegrityFlags } : {}),
        }
      })
    : []
  const normalizedCandidates = applyJobDescriptionScoringMode(candidates, jobDescriptionContext)
  const scoredCandidates = []
  const parseFailedCandidates = []
  const scoringFailedCandidates = []
  const scoringFailures = []
  const validationFailureCounters = {}
  const parseFailureSubtypeCounters = {}

  const incrementValidationFailureCounter = (reason) => {
    const key = String(reason || '').trim().toLowerCase()
    if (!key) return
    validationFailureCounters[key] = (validationFailureCounters[key] || 0) + 1
  }
  const incrementParseFailureSubtypeCounter = (subtype) => {
    const key = String(subtype || '').trim().toLowerCase()
    if (!key) return
    parseFailureSubtypeCounters[key] = (parseFailureSubtypeCounters[key] || 0) + 1
  }

  for (const candidate of normalizedCandidates) {
    const candidateValidationReasons = getCandidateValidationFailureReasons(candidate)
    const placeholderNarrativeFailure = isFailureNarrativeCandidate(candidate) || isFailurePlaceholderCandidate(candidate)

    if (!isCandidateExtractionValid(candidate) || placeholderNarrativeFailure) {
      candidateValidationReasons
        .filter((reason) => reason.startsWith('failure_'))
        .forEach(incrementValidationFailureCounter)
      const parseFailureSubtype = placeholderNarrativeFailure
        ? 'ai_placeholder_output'
        : 'ai_output_validation_failed'
      incrementParseFailureSubtypeCounter(parseFailureSubtype)
      parseFailedCandidates.push({ ...candidate, resumeProcessingStatus: 'parse_failed' })
      scoringFailures.push({
        candidateId: candidate?.candidateId || candidate?.id || null,
        resumeId: candidate?.resumeId || String(resumeId || ''),
        reason: 'parse_failed::ai_output_validation_failed',
        parseFailureSubtype,
      })
      continue
    }
    if (!isCandidateValidForScoredOutcome(candidate)) {
      candidateValidationReasons
        .filter((reason) => !reason.startsWith('failure_'))
        .forEach(incrementValidationFailureCounter)
      scoringFailedCandidates.push({
        ...candidate,
        score: null,
        profile_score: null,
        matchScore: {
          ...(candidate?.matchScore && typeof candidate.matchScore === 'object' ? candidate.matchScore : {}),
          score: null,
        },
        resumeProcessingStatus: 'scoring_failed',
        scoringFailureReason: 'scoring_failed::missing_finite_score',
      })
      scoringFailures.push({
        candidateId: candidate?.candidateId || candidate?.id || null,
        resumeId: candidate?.resumeId || String(resumeId || ''),
        reason: 'scoring_failed::missing_finite_score',
      })
      continue
    }

    scoredCandidates.push({
      ...candidate,
      resumeProcessingStatus: 'scored',
    })
  }

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
    candidates: scoredCandidates,
    scoringFailures,
    candidatesWithScoringFailures: [...parseFailedCandidates, ...scoringFailedCandidates],
    parseOutcome: scoredCandidates.length > 0 ? 'success' : (parseFailedCandidates.length > 0 ? 'failed' : 'partial'),
    failureCategory: scoredCandidates.length > 0 ? null : (parseFailedCandidates.length > 0 ? 'ai_output_validation_failed' : null),
    parseMeta: {
      preflight: {
        extractableTextRatio: preflight.extractableTextRatio,
        imageOnlyLikely: preflight.imageOnlyLikely,
      },
      extractionMethod: extractionResult?.methodUsed || 'failed',
      extractionDiagnosticsSummary: buildExtractionDiagnosticsSummary({
        extractionResult,
        hasUsableExtractedText,
      }),
      extractionSelectionDiagnostics: selectionDiagnostics,
      extractionStageDiagnostics: extractionResult?.stageDiagnostics || null,
      rawTextCharCount: extractedRawText.length,
      parseStatus: scoredCandidates.length > 0 ? 'complete' : (parseFailedCandidates.length > 0 ? 'failed' : 'partial'),
      scoringStatus: (parseFailedCandidates.length > 0 || scoringFailedCandidates.length > 0)
        ? 'failed'
        : (jobDescriptionContext?.hasContext ? (scoredCandidates.length > 0 ? 'complete' : 'partial') : 'skipped_no_job_description'),
      validationFailureCounters,
      parseFailureSubtypeCounters,
      parseFailureSubtype: parseFailureSubtypeCounters.ai_placeholder_output > 0
        ? 'ai_placeholder_output'
        : (parseFailureSubtypeCounters.ai_output_validation_failed > 0 ? 'ai_output_validation_failed' : null),
      provider: analysisResult?.provider || parseMethod,
      model: parseModel || analysisResult?.model || null,
      maxOutputTokens: parseMaxOutputTokens,
      placeholderRetryAttempted,
      placeholderRetrySucceeded,
      placeholderRetryReason,
    },
  }

  const latestPromptVersion = usageAttempts.length > 0
    ? Number(usageAttempts[usageAttempts.length - 1]?.promptVersion || 1)
    : 1

  await emitParseValidationReasonMetrics({
    userId: job.data.userId,
    validationFailureCounters,
    tags: {
      model: parseModel || analysisResult?.model || null,
      provider: parseProvider || analysisResult?.provider || parseMethod,
      promptVersion: latestPromptVersion,
      mimeType,
      extractionMethod: extractionResult?.methodUsed || 'failed',
    },
  })

  const parseDurationMs = Date.now() - startedAt
  if (scoredCandidates.length === 0) {
    const fallbackFailureCategory = mapParseErrorCode(scoringFailures[0]?.reason || 'parse_failed')
    const terminalFailureReason = scoringFailures[0]?.reason || 'scoring_failed::missing_candidate_score_or_reasoning'
    const terminalFailureError = new Error(terminalFailureReason)
    terminalFailureError.parseFailureDetails = {
      technicalDetails: terminalFailureReason,
      provider: parseProvider || parseMethod || null,
      model: parseModel || analysisResult?.model || null,
      attempts: usageAttempts,
      tokenUsage: usageAttempts.map((attempt) => ({
        provider: attempt?.provider || null,
        model: attempt?.model || null,
        tokenUsage: attempt?.tokenUsage || null,
      })),
    }
    await pool.query(
      `UPDATE resumes
       SET parse_status = 'failed',
           parse_result = $2::jsonb,
           parse_error = $3,
           parse_error_code = $4,
           parse_duration_ms = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [resumeId, JSON.stringify(parseResult), terminalFailureReason, fallbackFailureCategory, parseDurationMs],
    )
    await setJobState(job.id, {
      status: 'failed',
      progress: 100,
      result: JSON.stringify(parseResult),
      error_message: terminalFailureReason,
      attempts: job.attemptsMade + 1,
    })
    await cacheJobResult(String(job.id), {
      status: 'failed',
      progress: 100,
      result: parseResult,
      error: terminalFailureReason,
    })
    throw terminalFailureError
  }

  const primaryCandidate = scoredCandidates[0] || null
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
         parse_error_code = NULL,
         parse_duration_ms = $12,
         updated_at = NOW(),
         raw_text = $13
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
      extractedRawText,
    ],
  )

  await setJobState(job.id, {
    status: 'complete',
    progress: 100,
    result: JSON.stringify(parseResult),
    error_message: null,
    attempts: job.attemptsMade + 1,
  })

  await upsertCandidateProfile({
    userId: job.data.userId,
    resumeId,
    profile: primaryCandidate,
    sourceParseJobId: job.id,
    sourceUpdatedAt: new Date(),
    schemaVersion: CANDIDATE_PROFILE_SCHEMA_VERSION,
  }).catch((error) => {
    console.warn('[Parse] Failed to upsert candidate profile snapshot:', error.message)
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
  console.log('[Parse][StageUsage]', { resumeId, parseJobId: job.id, failureCategory: null, stageUsage: { parse: { attempted: true }, extraction: extractionResult?.stageDiagnostics || null, ocr: { attempted: Boolean(preflight.routeToOcr), status: ocrOutcome ? "failed" : (preflight.routeToOcr ? "success" : "skipped") }, score: { attempted: true, skipped: false }, fallback: { attempted: true } } })
  return parseResult
}

export function registerParseResumeJobProcessor() {
  parseQueue.process(async (job) => {
    try {
      return await runParse(job)
    } catch (error) {
      const normalizedError = isLocalPostAiValidationFailure(error)
        ? buildLocalPostAiFailureNormalizedPayload(error)
        : normalizeProviderError(error)
      const isTerminalFailure = isTerminalJobFailure(job)
      const normalizedMessage = String(normalizedError.normalizedMessage || '').trim()
      const normalizedErrorCategory = String(normalizedError.category || '').trim()
      const parseErrorWithReasonPrefix = normalizedMessage.includes('::')
        ? normalizedMessage
        : `parse_failed::${normalizedMessage || 'Unknown parsing failure.'}`
      const parseErrorCode = mapParseErrorCode(normalizedErrorCategory || parseErrorWithReasonPrefix)
      if (isTerminalFailure) {
        const parseDurationMs = Date.now() - Number(job.timestamp || Date.now())
        await pool.query(
          `UPDATE resumes
           SET parse_status = 'failed',
               parse_error_code = $2,
               parse_error = $3,
               parse_duration_ms = COALESCE(parse_duration_ms, $4),
               updated_at = NOW()
           WHERE id = $1`,
          [job.data.resumeId, parseErrorCode, parseErrorWithReasonPrefix.slice(0, 500), parseDurationMs],
        )
      }

      await setJobState(job.id, {
        status: isTerminalFailure ? 'failed' : 'retrying',
        progress: isTerminalFailure ? 100 : Number(job.progress() || 0),
        error_message: parseErrorWithReasonPrefix,
        attempts: job.attemptsMade + 1,
      })

      if (isTerminalFailure) {
        console.log('[Parse][StageUsage]', { resumeId: job.data.resumeId, parseJobId: job.id, failureCategory: normalizedErrorCategory || "unknown", stageUsage: { parse: { attempted: true }, ocr: { attempted: Boolean(error?.preflightFailure), status: error?.preflightFailure ? "failed" : "unknown" }, score: { attempted: false, skipped: true, skipReason: "parse_or_preflight_failure" }, fallback: { attempted: true } } })
        await cacheJobResult(String(job.id), {
          status: 'failed',
          progress: 100,
          result: null,
          error: parseErrorWithReasonPrefix,
        })
      }

      throw error
    }
  })

  console.log('[Queue] Parse resume worker registered')
}
