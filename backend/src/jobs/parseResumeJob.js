import { Buffer } from 'node:buffer'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { pool } from '../db/client.js'
import { cacheJobResult, parseQueue } from '../services/jobQueue.js'
import { analyzeResumeWithConfiguredFallback, canonicalizeAnalysisScoreFields, isAiScoringContractV2ShadowEnabled, normalizeAiScoringContractV2, runAiScoringContractV2ShadowAnalysis } from '../services/aiResumeAnalysisService.js'
import {
  buildSafeResumeFileDiagnostics,
  logSafeResumeFileDiagnostics,
  prepareResumePayloadForAnalysis as prepareDocumentPayloadForAnalysis,
} from '../services/resumeDocumentExtractionService.js'
import { triggerWebhook } from '../services/webhookService.js'
import { CANDIDATE_PROFILE_SCHEMA_VERSION, upsertCandidateProfile } from '../services/candidateProfilesService.js'
import { normalizeProviderError } from './parseProviderError.js'
import { resolveCanonicalCandidateIdentity } from '../utils/candidateIdentity.js'
import { classifyParseJobRetryability } from './parseJobErrorClassifier.js'
import { normalizeCandidateEducation } from '../utils/candidateEducation.js'
import { normalizeCandidateFieldArray } from '../utils/candidateStructuredFields.js'
import { isLegacyDocExtractionEnabled } from '../services/legacyDocExtractionService.js'
import { createUnsupportedLegacyWordError, getLegacyWordDocumentDetection } from '../utils/legacyWordDocument.js'
import { emitAiScoringContractV2ScoreDeltaDiagnostic, emitScoreContractShadowDiagnostic } from '../services/scoreContractShadowDiagnostics.js'
import {
  SCORE_CACHE_SCORING_CONTRACT_VERSION,
  buildScoreCacheEligibilityDiagnostic,
  buildScoreCacheJobDescriptionFingerprint,
  buildScoreCacheKey,
  buildScoreCacheResumeFingerprint,
  buildScoreCacheValue,
} from '../services/aiScoreCacheService.js'
import { buildSafeScoreCacheStoragePayload, getScoreCacheEntry, upsertScoreCacheEntry } from '../services/aiScoreCacheStorageService.js'
import { scoreCandidateDeterministically } from '../services/deterministicJdFitScoringService.js'
import { evaluateExperienceRange } from '../utils/experienceRange.js'

let analyzeResumeWithConfiguredFallbackOverrideForTests = null
let cacheJobResultOverrideForTests = null
let upsertScoreCacheEntryOverrideForTests = null
let getScoreCacheEntryOverrideForTests = null
let scoreCandidateDeterministicallyOverrideForTests = null
let runAiScoringContractV2ShadowAnalysisOverrideForTests = null

function safeFingerprint(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

function getAnalyzeResumeWithConfiguredFallback() {
  return analyzeResumeWithConfiguredFallbackOverrideForTests || analyzeResumeWithConfiguredFallback
}

function getCacheJobResult() {
  return cacheJobResultOverrideForTests || cacheJobResult
}

function getUpsertScoreCacheEntry() {
  return upsertScoreCacheEntryOverrideForTests || upsertScoreCacheEntry
}

function getScoreCacheEntryReader() {
  return getScoreCacheEntryOverrideForTests || getScoreCacheEntry
}

function getDeterministicJdFitScorer() {
  return scoreCandidateDeterministicallyOverrideForTests || scoreCandidateDeterministically
}

function getAiScoringContractV2ShadowRunner() {
  return runAiScoringContractV2ShadowAnalysisOverrideForTests || runAiScoringContractV2ShadowAnalysis
}

export function __setParseResumeJobTestOverrides({
  analyzeResumeWithConfiguredFallback: analyzeOverride = null,
  cacheJobResult: cacheOverride = null,
  upsertScoreCacheEntry: upsertScoreCacheEntryOverride = null,
  getScoreCacheEntry: getScoreCacheEntryOverride = null,
  scoreCandidateDeterministically: scoreCandidateDeterministicallyOverride = null,
  runAiScoringContractV2ShadowAnalysis: runAiScoringContractV2ShadowAnalysisOverride = null,
} = {}) {
  analyzeResumeWithConfiguredFallbackOverrideForTests = analyzeOverride
  cacheJobResultOverrideForTests = cacheOverride
  upsertScoreCacheEntryOverrideForTests = upsertScoreCacheEntryOverride
  getScoreCacheEntryOverrideForTests = getScoreCacheEntryOverride
  scoreCandidateDeterministicallyOverrideForTests = scoreCandidateDeterministicallyOverride
  runAiScoringContractV2ShadowAnalysisOverrideForTests = runAiScoringContractV2ShadowAnalysisOverride
}

export function __resetParseResumeJobTestOverrides() {
  analyzeResumeWithConfiguredFallbackOverrideForTests = null
  cacheJobResultOverrideForTests = null
  upsertScoreCacheEntryOverrideForTests = null
  getScoreCacheEntryOverrideForTests = null
  scoreCandidateDeterministicallyOverrideForTests = null
  runAiScoringContractV2ShadowAnalysisOverrideForTests = null
}

export function isTerminalJobFailure(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts || 1)
}

function toBuffer(streamOrBuffer) {
  if (Buffer.isBuffer(streamOrBuffer)) return Promise.resolve(streamOrBuffer)
  return new Promise((resolve, reject) => {
    const chunks = []
    streamOrBuffer.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    streamOrBuffer.on('end', () => resolve(Buffer.concat(chunks)))
    streamOrBuffer.on('error', reject)
  })
}

function createParseTimeoutError(stage, timeoutMs) {
  const error = new Error(`Parse ${stage} timed out after ${Math.round(timeoutMs / 1000)} seconds`)
  error.category = 'parse_stage_timeout'
  error.nonRetriable = true
  return error
}

async function withParseStageTimeout(promise, { stage, timeoutMs }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise
  let timeoutId
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(createParseTimeoutError(stage, timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeoutId)
  }
}

async function loadFileBufferBase64ForParseJob(jobData, { logger = console } = {}) {
  if (jobData?.fileBufferBase64) {
    return { fileBufferBase64: jobData.fileBufferBase64, source: 'inline_base64' }
  }
  const assembledS3Key = String(jobData?.assembledS3Key || '').trim()
  if (!assembledS3Key) {
    throw new Error('Resume payload is empty')
  }
  const bucket = process.env.AWS_S3_BUCKET || s3Bucket
  if (!bucket) {
    throw new Error('AWS_S3_BUCKET is required to load assembled resume uploads')
  }
  logger?.info?.('[Parse] Loading assembled resume upload from S3 reference', {
    resumeId: jobData?.resumeId || null,
    analysisId: jobData?.analysisId || null,
    parseJobId: jobData?.jobId || null,
    fileSize: jobData?.fileSize || null,
    hasSha256: Boolean(jobData?.assembledSha256),
  })
  const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: assembledS3Key }))
  const fileBuffer = await toBuffer(object.Body)
  const actualSha256 = createHash('sha256').update(fileBuffer).digest('hex')
  if (jobData?.assembledSha256 && actualSha256 !== jobData.assembledSha256) {
    const error = new Error('assembled_s3_sha256_mismatch::Uploaded resume checksum mismatch before parsing')
    error.category = 'assembled_s3_sha256_mismatch'
    error.nonRetriable = true
    throw error
  }
  return { fileBufferBase64: fileBuffer.toString('base64'), source: 'assembled_s3' }
}

function normalizeUnavailableReason(reason) {
  const raw = String(reason || '').trim()
  return raw ? raw.slice(0, 180) : 'unknown'
}

const PARSE_STAGE_TIMEOUT_MS = Number.parseInt(process.env.PARSE_STAGE_TIMEOUT_MS || String(8 * 60 * 1000), 10)
const AI_ANALYSIS_TIMEOUT_MS = Number.parseInt(process.env.AI_ANALYSIS_TIMEOUT_MS || String(8 * 60 * 1000), 10)
const s3Bucket = process.env.AWS_S3_BUCKET
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
})

const PRE_PROVIDER_LOCAL_EXTRACTION_FAILURE_CATEGORIES = new Set([
  'docx_empty_extraction',
  'docx_invalid_or_unreadable',
  'docx_dependency_missing',
  'docx_extraction_failed',
  'legacy_doc_extraction_failed',
  'extraction_empty',
  'legacy_word_format',
  'resume_unsupported_legacy_doc',
  'unsupported_file_format',
  'local_payload_validation_failure',
])

const PRE_PROVIDER_LOCAL_EXTRACTION_FAILURE_PATTERNS = [
  /docx_empty_extraction/i,
  /docx_invalid_or_unreadable/i,
  /docx_dependency_missing/i,
  /docx_extraction_failed/i,
  /legacy_doc_extraction_failed/i,
  /extraction_empty/i,
  /legacy_word_format/i,
  /resume_unsupported_legacy_doc/i,
  /legacy \.doc files are not supported/i,
  /legacy word \.doc files are not supported/i,
  /unsupported (file )?format/i,
  /local request validation failed/i,
  /local payload validation failed/i,
  /payload validation failed/i,
]

function getFailureCategory(error) {
  const message = String(error?.message || error?.unavailableReason || '').trim()
  const prefixedCategory = message.match(/^([a-z0-9_]+)::/i)?.[1]
  return normalizeString(error?.category)
    || normalizeString(error?.extractionCategory)
    || normalizeString(error?.failureCategory)
    || normalizeString(prefixedCategory)
}

function isPreProviderLocalExtractionFailure(error) {
  const category = getFailureCategory(error)
  if (PRE_PROVIDER_LOCAL_EXTRACTION_FAILURE_CATEGORIES.has(category)) return true

  const message = String(error?.message || error?.unavailableReason || '').trim()
  return PRE_PROVIDER_LOCAL_EXTRACTION_FAILURE_PATTERNS.some((pattern) => pattern.test(message))
}

function normalizeProviderName(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized.includes('anthropic')) return 'anthropic'
  if (normalized.includes('openai')) return 'openai'
  return normalized
}

function getProviderFromFailureMetadata(error) {
  return normalizeProviderName(error?.provider)
    || normalizeProviderName(error?.providerName)
    || normalizeProviderName(error?.providerLabel)
}

function getProviderFromAttempt(attempt) {
  const rawProvider = normalizeString(attempt?.provider)
    || normalizeString(attempt?.providerName)
    || normalizeString(attempt?.providerLabel)

  return normalizeProviderName(rawProvider) ? rawProvider : null
}

function parseRuntimeAllowlist(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function runtimeAllowlistMatches(value, allowlist) {
  if (allowlist.length === 0) return false
  if (value === null || value === undefined || value === '') return false
  return allowlist.includes(String(value))
}

function isAiScoringContractV2VisibleApplyEnabled(env = process.env) {
  return String(env.AI_SCORING_CONTRACT_V2_VISIBLE_APPLY_ENABLED || '').trim().toLowerCase() === 'true'
}

function isAiScoringContractV2VisibleApplyAllUsersEnabled(env = process.env) {
  return String(env.AI_SCORING_CONTRACT_V2_VISIBLE_APPLY_ALL_USERS || '').trim().toLowerCase() === 'true'
}

function buildAiScoringContractV2VisibleApplyAllowlistDiagnostic({ userId, analysisId, env = process.env } = {}) {
  const userAllowlist = parseRuntimeAllowlist(env.AI_SCORING_CONTRACT_V2_VISIBLE_APPLY_ALLOWED_USER_IDS)
  const analysisAllowlist = parseRuntimeAllowlist(env.AI_SCORING_CONTRACT_V2_VISIBLE_APPLY_ALLOWED_ANALYSIS_IDS)
  const allowedByUser = runtimeAllowlistMatches(userId, userAllowlist)
  const allowedByAnalysis = runtimeAllowlistMatches(analysisId, analysisAllowlist)
  const allUsersEnabled = isAiScoringContractV2VisibleApplyAllUsersEnabled(env)
  const allowlistMatched = allowedByUser || allowedByAnalysis

  return {
    all_users_enabled: allUsersEnabled,
    allowlist_matched: allowlistMatched,
    allowed_by_user_allowlist: allowedByUser,
    allowed_by_analysis_allowlist: allowedByAnalysis,
    eligible_for_visible_apply: allUsersEnabled || allowlistMatched,
  }
}

const AI_SCORING_CONTRACT_V2_VISIBLE_CONFIDENCE_RANK = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
})

function normalizeConfiguredV2VisibleApplyMinimumConfidence(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return AI_SCORING_CONTRACT_V2_VISIBLE_CONFIDENCE_RANK[normalized] ? normalized : 'high'
}

function normalizeV2VisibleApplyContractConfidence(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return AI_SCORING_CONTRACT_V2_VISIBLE_CONFIDENCE_RANK[normalized] ? normalized : null
}

function confidenceMeetsMinimum(confidence, minimumConfidence) {
  const normalizedConfidence = normalizeV2VisibleApplyContractConfidence(confidence)
  const normalizedMinimum = normalizeConfiguredV2VisibleApplyMinimumConfidence(minimumConfidence)

  if (!normalizedConfidence) return false

  return AI_SCORING_CONTRACT_V2_VISIBLE_CONFIDENCE_RANK[normalizedConfidence] >= AI_SCORING_CONTRACT_V2_VISIBLE_CONFIDENCE_RANK[normalizedMinimum]
}

function resolveCandidateMatchScoreValue(candidate = {}) {
  if (candidate?.matchScore && typeof candidate.matchScore === 'object' && !Array.isArray(candidate.matchScore)) {
    return resolveNumericScore(candidate.matchScore.score)
  }
  return resolveNumericScore(candidate?.matchScore)
}

function roundVisibleScoreOutOfTen(score) {
  return Math.round((score / 10) * 10) / 10
}

function buildAiScoringContractV2VisibleScoreApplyDiagnostic({
  candidate = {},
  parseDiagnostics = {},
  fileExtension = null,
  extractionMethod = null,
  metadata = {},
  enabled = false,
  allUsersEnabled = false,
  allowlistMatched = false,
  allowedByUserAllowlist = false,
  allowedByAnalysisAllowlist = false,
  applied = false,
  skipReason = null,
  originalVisibleScore = null,
  appliedVisibleScore = null,
} = {}) {
  const contract = candidate?.ai_scoring_contract_v2 && typeof candidate.ai_scoring_contract_v2 === 'object' && !Array.isArray(candidate.ai_scoring_contract_v2)
    ? candidate.ai_scoring_contract_v2
    : null
  const hasBothScores = originalVisibleScore !== null && appliedVisibleScore !== null
  return {
    analysis_id: metadata.analysisId ?? metadata.analysis_id ?? null,
    resume_id: metadata.resumeId ?? metadata.resume_id ?? candidate?.resumeId ?? candidate?.resume_id ?? null,
    parse_job_id: metadata.parseJobId ?? metadata.parse_job_id ?? null,
    enabled,
    all_users_enabled: allUsersEnabled,
    allowlist_matched: allowlistMatched,
    allowed_by_user_allowlist: allowedByUserAllowlist,
    allowed_by_analysis_allowlist: allowedByAnalysisAllowlist,
    applied,
    skip_reason: skipReason,
    original_visible_score: originalVisibleScore,
    applied_visible_score: appliedVisibleScore,
    score_delta: hasBothScores ? Math.round((appliedVisibleScore - originalVisibleScore) * 10) / 10 : null,
    score_confidence: contract?.score_confidence || null,
    file_extension: fileExtension ?? parseDiagnostics?.extension ?? parseDiagnostics?.sourceFormat ?? null,
    extraction_method: extractionMethod ?? parseDiagnostics?.extractionMethod ?? parseDiagnostics?.extraction_method ?? null,
    normalizedTextFingerprint: parseDiagnostics?.normalizedTextFingerprint ?? parseDiagnostics?.normalized_text_fingerprint ?? null,
    normalizedTextCharCount: resolveNumericScore(parseDiagnostics?.normalizedTextCharCount),
    has_job_description_context: Boolean(contract?.has_job_description_context),
    scoring_contract_version: contract?.scoring_contract_version || null,
  }
}

function logAiScoringContractV2VisibleScoreApplyExperiment(diagnostic, logger = console) {
  try {
    logger.info?.('[AiScoringContractV2] visible_score_apply_experiment', diagnostic)
  } catch (_) {
    // Diagnostics must never affect analysis completion.
  }
}

function applyAiScoringContractV2VisibleScoreToCandidate(candidate, { appliedScore, reason }) {
  const originalVisibleScore = resolveCurrentAiScore(candidate)
  const originalMatchScore = resolveCandidateMatchScoreValue(candidate)
  const originalFitAssessmentScore = resolveNumericScore(candidate?.fit_assessment?.overall_fit_score)
  const nextCandidate = {
    ...candidate,
    score: appliedScore,
    v2_visible_score_experiment: {
      original_visible_score: originalVisibleScore,
      original_match_score: originalMatchScore,
      original_fit_assessment_score: originalFitAssessmentScore,
      applied_score: appliedScore,
      applied_at: new Date().toISOString(),
      reason,
      contract_version: candidate?.ai_scoring_contract_v2?.scoring_contract_version || null,
    },
  }

  nextCandidate.matchScore = {
    ...(candidate?.matchScore && typeof candidate.matchScore === 'object' && !Array.isArray(candidate.matchScore) ? candidate.matchScore : {}),
    score: appliedScore,
    score_out_of_ten: roundVisibleScoreOutOfTen(appliedScore),
  }

  nextCandidate.fit_assessment = {
    ...(candidate?.fit_assessment && typeof candidate.fit_assessment === 'object' && !Array.isArray(candidate.fit_assessment) ? candidate.fit_assessment : {}),
    overall_fit_score: appliedScore,
  }

  return nextCandidate
}

export function applyAiScoringContractV2VisibleScoreExperiment({
  candidates = [],
  userId = null,
  analysisId = null,
  resumeId = null,
  parseJobId = null,
  parseDiagnostics = {},
  fileExtension = null,
  extractionMethod = null,
  env = process.env,
  logger = console,
} = {}) {
  if (!Array.isArray(candidates)) return candidates
  const enabled = isAiScoringContractV2VisibleApplyEnabled(env)
  const allowlistDiagnostic = buildAiScoringContractV2VisibleApplyAllowlistDiagnostic({ userId, analysisId, env })
  const allUsersEnabled = allowlistDiagnostic.all_users_enabled
  const allowlistMatched = allowlistDiagnostic.allowlist_matched
  const eligibleForVisibleApply = allowlistDiagnostic.eligible_for_visible_apply
  const minimumConfidence = normalizeConfiguredV2VisibleApplyMinimumConfidence(env.AI_SCORING_CONTRACT_V2_VISIBLE_APPLY_MIN_CONFIDENCE || 'high')

  return candidates.map((candidate) => {
    let skipReason = null
    let appliedCandidate = candidate
    const originalVisibleScore = resolveCurrentAiScore(candidate)
    const contract = candidate?.ai_scoring_contract_v2 && typeof candidate.ai_scoring_contract_v2 === 'object' && !Array.isArray(candidate.ai_scoring_contract_v2)
      ? candidate.ai_scoring_contract_v2
      : null
    const v2Score = resolveNumericScore(contract?.weighted_total_score_recomputed)

    try {
      if (!enabled) skipReason = 'disabled'
      else if (!eligibleForVisibleApply) skipReason = 'allowlist_not_matched'
      else if (!contract) skipReason = 'v2_missing'
      else if (contract.scoring_contract_version !== 'ai_jd_fit_rubric_v2') skipReason = 'contract_version_mismatch'
      else if (contract.has_job_description_context !== true) skipReason = 'missing_job_description_context'
      else if (v2Score === null || v2Score < 0 || v2Score > 100) skipReason = 'invalid_v2_score'
      else if (!confidenceMeetsMinimum(contract.score_confidence, minimumConfidence)) skipReason = 'confidence_below_minimum'
      else {
        appliedCandidate = applyAiScoringContractV2VisibleScoreToCandidate(candidate, {
          appliedScore: v2Score,
          reason: 'ai_scoring_contract_v2_visible_apply_experiment',
        })
      }
    } catch (_) {
      skipReason = 'error'
      appliedCandidate = candidate
    }

    logAiScoringContractV2VisibleScoreApplyExperiment(buildAiScoringContractV2VisibleScoreApplyDiagnostic({
      candidate,
      parseDiagnostics,
      fileExtension,
      extractionMethod,
      metadata: { analysisId, resumeId, parseJobId },
      enabled,
      allUsersEnabled,
      allowlistMatched,
      allowedByUserAllowlist: allowlistDiagnostic.allowed_by_user_allowlist,
      allowedByAnalysisAllowlist: allowlistDiagnostic.allowed_by_analysis_allowlist,
      applied: !skipReason,
      skipReason,
      originalVisibleScore,
      appliedVisibleScore: !skipReason ? v2Score : null,
    }), logger)

    return appliedCandidate
  })
}

function buildRuntimeScoreCacheAllowlistDiagnostic({ userId, analysisId, env = process.env } = {}) {
  const userAllowlist = parseRuntimeAllowlist(env.AI_SCORE_CACHE_ALLOWED_USER_IDS)
  const analysisAllowlist = parseRuntimeAllowlist(env.AI_SCORE_CACHE_ALLOWED_ANALYSIS_IDS)
  const hasRuntimeAllowlist = userAllowlist.length > 0 || analysisAllowlist.length > 0
  const allowedByUser = runtimeAllowlistMatches(userId, userAllowlist)
  const allowedByAnalysis = runtimeAllowlistMatches(analysisId, analysisAllowlist)

  return {
    has_runtime_allowlist: hasRuntimeAllowlist,
    runtime_allowlist_matched: hasRuntimeAllowlist && (allowedByUser || allowedByAnalysis),
    runtime_allowed_by_user_allowlist: allowedByUser,
    runtime_allowed_by_analysis_allowlist: allowedByAnalysis,
  }
}


function isDeterministicJdFitShadowEnabled(env = process.env) {
  return String(env.DETERMINISTIC_JD_FIT_SHADOW_ENABLED || '').trim().toLowerCase() === 'true'
}

function isDeterministicJdFitApplyEnabled(env = process.env) {
  return String(env.DETERMINISTIC_JD_FIT_APPLY_ENABLED || '').trim().toLowerCase() === 'true'
}

function buildDeterministicJdFitShadowAllowlistDiagnostic({ userId, analysisId, env = process.env } = {}) {
  const userAllowlist = parseRuntimeAllowlist(env.DETERMINISTIC_JD_FIT_SHADOW_ALLOWED_USER_IDS)
  const analysisAllowlist = parseRuntimeAllowlist(env.DETERMINISTIC_JD_FIT_SHADOW_ALLOWED_ANALYSIS_IDS)
  const allowedByUser = runtimeAllowlistMatches(userId, userAllowlist)
  const allowedByAnalysis = runtimeAllowlistMatches(analysisId, analysisAllowlist)

  return {
    has_allowlist: userAllowlist.length > 0 || analysisAllowlist.length > 0,
    allowlist_matched: allowedByUser || allowedByAnalysis,
  }
}

function buildDeterministicJdFitApplyAllowlistDiagnostic({ userId, analysisId, env = process.env } = {}) {
  const userAllowlist = parseRuntimeAllowlist(env.DETERMINISTIC_JD_FIT_APPLY_ALLOWED_USER_IDS)
  const analysisAllowlist = parseRuntimeAllowlist(env.DETERMINISTIC_JD_FIT_APPLY_ALLOWED_ANALYSIS_IDS)
  const allowedByUser = runtimeAllowlistMatches(userId, userAllowlist)
  const allowedByAnalysis = runtimeAllowlistMatches(analysisId, analysisAllowlist)

  return {
    allowlist_matched: allowedByUser || allowedByAnalysis,
    allowed_by_user_allowlist: allowedByUser,
    allowed_by_analysis_allowlist: allowedByAnalysis,
  }
}

function resolveCurrentAiScore(candidate = {}) {
  return resolveNumericScore(candidate?.matchScore?.score)
    ?? resolveNumericScore(candidate?.score)
    ?? resolveNumericScore(candidate?.fit_assessment?.overall_fit_score)
}

function buildSafeDeterministicJdFitShadowDiagnostic({
  action = 'skip',
  candidate = {},
  deterministicResult = null,
  userId = null,
  analysisId = null,
  resumeId = null,
  jobDescriptionContext = null,
  allowlistMatched = false,
  provider = null,
  model = null,
} = {}) {
  const currentAiScore = resolveCurrentAiScore(candidate)
  const deterministicScore = resolveNumericScore(deterministicResult?.final_score)
  const breakdown = deterministicResult?.scoring_breakdown && typeof deterministicResult.scoring_breakdown === 'object'
    ? deterministicResult.scoring_breakdown
    : {}

  return {
    action,
    analysis_id: analysisId || null,
    resume_id: resumeId || candidate?.resumeId || null,
    user_id: userId ?? null,
    provider: provider || null,
    model: model || null,
    scoring_contract_version: deterministicResult?.scoring_contract_version || null,
    scoring_mode: deterministicResult?.scoring_mode || null,
    deterministic_final_score: deterministicScore,
    current_ai_score: currentAiScore,
    score_delta: deterministicScore !== null && currentAiScore !== null ? Math.round((deterministicScore - currentAiScore) * 10) / 10 : null,
    score_band: deterministicResult?.score_band || null,
    verdict: deterministicResult?.verdict || null,
    requirement_score: resolveNumericScore(breakdown.requirement_match?.score),
    skill_score: resolveNumericScore(breakdown.skill_alignment?.score),
    requirement_matched_bucket_count: resolveNumericScore(breakdown.requirement_match?.normalized_requirement_match_count),
    requirement_missing_bucket_count: resolveNumericScore(breakdown.requirement_match?.normalized_requirement_missing_count),
    skill_matched_bucket_count: resolveNumericScore(breakdown.skill_alignment?.normalized_requirement_match_count),
    skill_missing_bucket_count: resolveNumericScore(breakdown.skill_alignment?.normalized_requirement_missing_count),
    structured_positive_bucket_count: resolveNumericScore(breakdown.requirement_match?.structured_positive_bucket_count),
    structured_positive_applied_bucket_count: resolveNumericScore(breakdown.requirement_match?.structured_positive_bucket_count),
    normalized_requirement_match_count: resolveNumericScore(breakdown.requirement_match?.normalized_requirement_match_count),
    normalized_requirement_missing_count: resolveNumericScore(breakdown.requirement_match?.normalized_requirement_missing_count),
    requirement_bucket_score_keys: Object.keys(breakdown.requirement_match?.requirement_bucket_scores || {}).sort(),
    skill_bucket_score_keys: Object.keys(breakdown.skill_alignment?.requirement_bucket_scores || {}).sort(),
    experience_score: resolveNumericScore(breakdown.experience_alignment?.score),
    location_score: resolveNumericScore(breakdown.location_alignment?.score),
    evidence_score: resolveNumericScore(breakdown.evidence_completeness?.score),
    risk_penalty: resolveNumericScore(breakdown.risk_penalty?.penalty),
    confidence_multiplier: resolveNumericScore(breakdown.confidence_adjustment?.multiplier),
    has_jd_context: Boolean(jobDescriptionContext?.hasContext),
    allowlist_matched: Boolean(allowlistMatched),
    role_gap_signal_count: resolveNumericScore(breakdown.experience_alignment?.role_gap_signal_count),
    final_score_before_rounding: resolveNumericScore(deterministicResult?.final_score_before_rounding),
    score_cap_applied: typeof deterministicResult?.score_cap_applied === 'boolean' ? deterministicResult.score_cap_applied : null,
    experience_relevance_cap_applied: typeof breakdown.experience_alignment?.experience_relevance_cap_applied === 'boolean'
      ? breakdown.experience_alignment.experience_relevance_cap_applied
      : null,
  }
}

function buildSafeDeterministicJdFitApplyDiagnostic({
  action = 'skip',
  candidate = {},
  deterministicResult = null,
  userId = null,
  analysisId = null,
  resumeId = null,
  jobDescriptionContext = null,
  allowlistMatched = false,
} = {}) {
  const originalAiScore = resolveCurrentAiScore(candidate)
  const deterministicScore = resolveNumericScore(deterministicResult?.final_score)
  const breakdown = deterministicResult?.scoring_breakdown && typeof deterministicResult.scoring_breakdown === 'object'
    ? deterministicResult.scoring_breakdown
    : {}

  return {
    action,
    analysis_id: analysisId || null,
    resume_id: resumeId || candidate?.resumeId || null,
    user_id: userId ?? null,
    deterministic_final_score: deterministicScore,
    original_ai_score: originalAiScore,
    applied_deterministic_score: action === 'applied' ? deterministicScore : null,
    score_delta: action === 'applied' && deterministicScore !== null && originalAiScore !== null ? Math.round((deterministicScore - originalAiScore) * 10) / 10 : null,
    scoring_contract_version: deterministicResult?.scoring_contract_version || null,
    scoring_mode: deterministicResult?.scoring_mode || null,
    allowlist_matched: Boolean(allowlistMatched),
    has_jd_context: Boolean(jobDescriptionContext?.hasContext),
    experience_score: resolveNumericScore(breakdown.experience_alignment?.score),
    resolved_experience_years: resolveNumericScore(breakdown.experience_alignment?.resolved_experience_years),
    required_min_experience_years: resolveNumericScore(breakdown.experience_alignment?.required_min_years),
    experience_shortfall_years: resolveNumericScore(breakdown.experience_alignment?.experience_shortfall_years),
    experience_resolution_source: typeof breakdown.experience_alignment?.experience_resolution_source === 'string'
      ? breakdown.experience_alignment.experience_resolution_source
      : null,
    requirement_score: resolveNumericScore(breakdown.requirement_match?.score),
    skill_score: resolveNumericScore(breakdown.skill_alignment?.score),
    requirement_matched_bucket_count: resolveNumericScore(breakdown.requirement_match?.normalized_requirement_match_count),
    requirement_missing_bucket_count: resolveNumericScore(breakdown.requirement_match?.normalized_requirement_missing_count),
    skill_matched_bucket_count: resolveNumericScore(breakdown.skill_alignment?.normalized_requirement_match_count),
    skill_missing_bucket_count: resolveNumericScore(breakdown.skill_alignment?.normalized_requirement_missing_count),
    structured_positive_bucket_count: resolveNumericScore(breakdown.requirement_match?.structured_positive_bucket_count),
    structured_positive_applied_bucket_count: resolveNumericScore(breakdown.requirement_match?.structured_positive_bucket_count),
    normalized_requirement_match_count: resolveNumericScore(breakdown.requirement_match?.normalized_requirement_match_count),
    normalized_requirement_missing_count: resolveNumericScore(breakdown.requirement_match?.normalized_requirement_missing_count),
    requirement_bucket_score_keys: Object.keys(breakdown.requirement_match?.requirement_bucket_scores || {}).sort(),
    skill_bucket_score_keys: Object.keys(breakdown.skill_alignment?.requirement_bucket_scores || {}).sort(),
    risk_penalty: resolveNumericScore(breakdown.risk_penalty?.penalty),
    confidence_multiplier: resolveNumericScore(breakdown.confidence_adjustment?.multiplier),
    final_score_before_rounding: resolveNumericScore(deterministicResult?.final_score_before_rounding),
    score_cap_applied: typeof deterministicResult?.score_cap_applied === 'boolean' ? deterministicResult.score_cap_applied : null,
    experience_relevance_cap_applied: typeof breakdown.experience_alignment?.experience_relevance_cap_applied === 'boolean'
      ? breakdown.experience_alignment.experience_relevance_cap_applied
      : null,
    below_min_experience_evidence_applied: typeof breakdown.experience_alignment?.below_min_experience_evidence_applied === 'boolean'
      ? breakdown.experience_alignment.below_min_experience_evidence_applied
      : null,
  }
}


const AI_SCORING_CONTRACT_V2_SAFE_DIAGNOSTIC_ANOMALY_CODES = new Set([
  'weighted_total_mismatch',
  'scoring_contract_version_mismatch',
  'skills_match_score_non_numeric',
  'relevant_experience_score_non_numeric',
  'education_relevance_score_non_numeric',
  'seniority_progression_score_non_numeric',
  'weighted_total_score_non_numeric',
  'skills_match_score_out_of_range_clamped',
  'relevant_experience_score_out_of_range_clamped',
  'education_relevance_score_out_of_range_clamped',
  'seniority_progression_score_out_of_range_clamped',
  'weighted_total_score_out_of_range_clamped',
  'below_minimum_experience_relevant_experience_capped',
  'below_minimum_experience_seniority_capped',
  'below_minimum_experience_weighted_total_capped',
])

function normalizeAiScoringContractV2DiagnosticAnomalies(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((entry) => normalizeString(entry))
    .filter((entry) => AI_SCORING_CONTRACT_V2_SAFE_DIAGNOSTIC_ANOMALY_CODES.has(entry))
}

function logAiScoringContractV2Diagnostic(candidate = {}, metadata = {}, logger = console, env = process.env) {
  if (!isAiScoringContractV2ShadowEnabled(metadata, env)) return null
  const contract = candidate?.ai_scoring_contract_v2
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return null
  const diagnostic = {
    analysis_id: metadata.analysisId || null,
    resume_id: metadata.resumeId || candidate?.resumeId || null,
    provider: metadata.provider || null,
    model: metadata.model || null,
    prompt_version: metadata.promptVersion || null,
    scoring_contract_version: contract.scoring_contract_version || null,
    weighted_total_score_recomputed: contract.weighted_total_score_recomputed ?? null,
    score_confidence: contract.score_confidence || null,
    scoring_anomalies: normalizeAiScoringContractV2DiagnosticAnomalies(contract.scoring_anomalies),
  }
  logger.info?.('[AiScoringContractV2] shadow diagnostic', diagnostic)
  return diagnostic
}

function logDeterministicJdFitApplyDiagnostic(logger, level, diagnostic) {
  if (level === 'warn') logger.warn?.('[DeterministicJdFit] apply diagnostic', diagnostic)
  else logger.info?.('[DeterministicJdFit] apply diagnostic', diagnostic)
}

function isEligibleDeterministicJdFitApply({ deterministicResult, jobDescriptionContext, allowlistMatched }) {
  return Boolean(
    allowlistMatched
    && jobDescriptionContext?.hasContext
    && deterministicResult?.scoring_mode === 'jd_fit'
    && deterministicResult?.scoring_contract_version === 'deterministic_jd_fit_v1'
    && resolveNumericScore(deterministicResult?.final_score) !== null,
  )
}

function applyDeterministicJdFitScoreToCandidate(candidate, deterministicResult) {
  const deterministicScore = resolveNumericScore(deterministicResult?.final_score)
  if (deterministicScore === null) return candidate

  const nextCandidate = {
    ...candidate,
    score: deterministicScore,
    deterministic_jd_fit_apply_metadata: {
      original_ai_score: resolveCurrentAiScore(candidate),
      applied_deterministic_score: deterministicScore,
      scoring_contract_version: deterministicResult?.scoring_contract_version || null,
      scoring_mode: deterministicResult?.scoring_mode || null,
    },
  }

  if (candidate?.matchScore && typeof candidate.matchScore === 'object' && !Array.isArray(candidate.matchScore)) {
    nextCandidate.matchScore = {
      ...candidate.matchScore,
      score: deterministicScore,
      score_out_of_ten: Math.round((deterministicScore / 10) * 10) / 10,
    }
  }

  if (candidate?.fit_assessment && typeof candidate.fit_assessment === 'object' && !Array.isArray(candidate.fit_assessment)) {
    nextCandidate.fit_assessment = {
      ...candidate.fit_assessment,
      overall_fit_score: deterministicScore,
    }
  }

  return nextCandidate
}

function hasDeterministicJdFitAppliedScore(candidate = {}) {
  return Boolean(
    candidate?.deterministic_jd_fit_apply_metadata
    && typeof candidate.deterministic_jd_fit_apply_metadata === 'object'
    && !Array.isArray(candidate.deterministic_jd_fit_apply_metadata),
  )
}

function hasV2VisibleScoreExperimentApplied(candidate = {}) {
  return Boolean(
    candidate?.v2_visible_score_experiment
    && typeof candidate.v2_visible_score_experiment === 'object'
    && !Array.isArray(candidate.v2_visible_score_experiment),
  )
}

function shouldSkipAiScoreCacheShadowForCandidate(candidate = {}) {
  return hasDeterministicJdFitAppliedScore(candidate) || hasV2VisibleScoreExperimentApplied(candidate)
}

export function applyDeterministicJdFitScoresForRuntimeTest({
  candidates = [],
  jobDescriptionContext,
  userId,
  analysisId,
  resumeId,
  logger = console,
  env = process.env,
} = {}) {
  if (!Array.isArray(candidates) || !isDeterministicJdFitApplyEnabled(env)) return candidates

  const allowlist = buildDeterministicJdFitApplyAllowlistDiagnostic({ userId, analysisId, env })
  if (!allowlist.allowlist_matched || !jobDescriptionContext?.hasContext) return candidates

  return candidates.map((candidate) => {
    let deterministicResult = null
    try {
      deterministicResult = getDeterministicJdFitScorer()(candidate, jobDescriptionContext)
      if (!isEligibleDeterministicJdFitApply({ deterministicResult, jobDescriptionContext, allowlistMatched: allowlist.allowlist_matched })) {
        return candidate
      }

      const appliedCandidate = applyDeterministicJdFitScoreToCandidate(candidate, deterministicResult)
      logDeterministicJdFitApplyDiagnostic(logger, 'info', buildSafeDeterministicJdFitApplyDiagnostic({
        action: 'applied', candidate, deterministicResult, userId, analysisId, resumeId, jobDescriptionContext, allowlistMatched: true,
      }))
      return appliedCandidate
    } catch (error) {
      logDeterministicJdFitApplyDiagnostic(logger, 'warn', buildSafeDeterministicJdFitApplyDiagnostic({
        action: 'failed_open', candidate, deterministicResult, userId, analysisId, resumeId, jobDescriptionContext, allowlistMatched: true,
      }))
      return candidate
    }
  })
}

function logDeterministicJdFitShadowDiagnostic(logger, level, diagnostic) {
  const payload = JSON.stringify(diagnostic)
  if (level === 'warn') logger.warn?.('[DeterministicJdFit] shadow diagnostic', payload)
  else logger.info?.('[DeterministicJdFit] shadow diagnostic', payload)
}

export function emitDeterministicJdFitShadowDiagnostic({
  candidate,
  jobDescriptionContext,
  userId,
  analysisId,
  resumeId,
  provider = null,
  model = null,
  logger = console,
  env = process.env,
} = {}) {
  if (!isDeterministicJdFitShadowEnabled(env)) return { computed: false, diagnostic: null }

  const allowlist = buildDeterministicJdFitShadowAllowlistDiagnostic({ userId, analysisId, env })
  if (!allowlist.allowlist_matched || !jobDescriptionContext?.hasContext) {
    const diagnostic = buildSafeDeterministicJdFitShadowDiagnostic({
      action: 'skip', candidate, userId, analysisId, resumeId, jobDescriptionContext, allowlistMatched: allowlist.allowlist_matched, provider, model,
    })
    logDeterministicJdFitShadowDiagnostic(logger, 'info', diagnostic)
    return { computed: false, diagnostic }
  }

  try {
    const deterministicResult = getDeterministicJdFitScorer()(candidate, jobDescriptionContext)
    const diagnostic = buildSafeDeterministicJdFitShadowDiagnostic({
      action: 'computed', candidate, deterministicResult, userId, analysisId, resumeId, jobDescriptionContext, allowlistMatched: true, provider, model,
    })
    logDeterministicJdFitShadowDiagnostic(logger, 'info', diagnostic)
    return { computed: true, diagnostic, deterministicResult }
  } catch (error) {
    const diagnostic = buildSafeDeterministicJdFitShadowDiagnostic({
      action: 'failed_open', candidate, userId, analysisId, resumeId, jobDescriptionContext, allowlistMatched: true, provider, model,
    })
    logDeterministicJdFitShadowDiagnostic(logger, 'warn', diagnostic)
    return { computed: false, diagnostic, error }
  }
}

function buildSafeJobDescriptionFingerprintSource(jobDescriptionContext = null) {
  if (!jobDescriptionContext?.hasContext) return null

  return {
    source: jobDescriptionContext.source || null,
    title: jobDescriptionContext.title || null,
    description: jobDescriptionContext.description || null,
    requirements: jobDescriptionContext.requirements || null,
    skills: Array.isArray(jobDescriptionContext.skills) ? jobDescriptionContext.skills : [],
    experienceYears: jobDescriptionContext.experienceYears ?? null,
    location: jobDescriptionContext.location || null,
    fileText: jobDescriptionContext.fileTextAvailable ? (jobDescriptionContext.fileText || null) : null,
  }
}

function resolveScoreCacheResumeFingerprint(preparedResumePayload = {}) {
  const diagnosticFingerprint = preparedResumePayload.diagnostics?.normalizedTextFingerprint
  if (diagnosticFingerprint) return diagnosticFingerprint

  return buildScoreCacheResumeFingerprint({ extractedText: preparedResumePayload.extractedText })
}

function buildScoreCacheMetadata({
  candidate,
  preparedResumePayload,
  jobDescriptionContext,
  userId,
  analysisId,
  aiResponse,
} = {}) {
  const resumeFingerprint = resolveScoreCacheResumeFingerprint(preparedResumePayload)
  const jobDescriptionFingerprint = buildScoreCacheJobDescriptionFingerprint({
    jobDescription: buildSafeJobDescriptionFingerprintSource(jobDescriptionContext),
    allowNoJobDescription: true,
  })
  const scoringContractVersion = candidate?.scoring_contract_version || null

  return {
    resumeFingerprint,
    jobDescriptionFingerprint,
    provider: aiResponse?.provider || null,
    model: aiResponse?.model || null,
    promptVersion: aiResponse?.promptVersion || null,
    compactMode: aiResponse?.mode || null,
    scoringContractVersion,
    userId,
    analysisId,
  }
}

function buildScoreCacheRuntimeDiagnostic(metadata, env = process.env) {
  return {
    ...buildScoreCacheEligibilityDiagnostic(metadata, env),
    ...buildRuntimeScoreCacheAllowlistDiagnostic({
      userId: metadata?.userId,
      analysisId: metadata?.analysisId,
      env,
    }),
    scoring_contract_version: metadata?.scoringContractVersion || null,
  }
}

function buildSafeReadShadowDiagnostic(diagnostic, overrides = {}) {
  return {
    action: overrides.action || 'skip',
    cache_key_version: diagnostic.cache_key_version,
    scoring_contract_version: diagnostic.scoring_contract_version,
    provider: diagnostic.provider,
    model: diagnostic.model,
    prompt_version: diagnostic.prompt_version,
    compact_mode: diagnostic.compact_mode,
    has_resume_fingerprint: diagnostic.has_resume_fingerprint,
    has_job_description_fingerprint: diagnostic.has_job_description_fingerprint,
    cache_hit: overrides.cache_hit ?? false,
    same_score: overrides.same_score ?? null,
    score_delta: overrides.score_delta ?? null,
    cache_key_fingerprint: overrides.cache_key_fingerprint ?? null,
  }
}

function buildCacheKeyFingerprint(cacheKey) {
  if (!cacheKey) return null
  return createHash('sha256').update(String(cacheKey)).digest('hex').slice(0, 16)
}

function resolveNumericScore(value) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export async function readAiScoreCacheShadowDiagnostic({
  candidate,
  preparedResumePayload,
  jobDescriptionContext,
  userId,
  analysisId,
  aiResponse,
  logger = console,
  env = process.env,
} = {}) {
  const metadata = buildScoreCacheMetadata({
    candidate,
    preparedResumePayload,
    jobDescriptionContext,
    userId,
    analysisId,
    aiResponse,
  })
  const diagnostic = buildScoreCacheRuntimeDiagnostic(metadata, env)

  if (
    metadata.scoringContractVersion !== SCORE_CACHE_SCORING_CONTRACT_VERSION
    || !diagnostic.has_runtime_allowlist
    || !diagnostic.runtime_allowlist_matched
    || !diagnostic.key_build_eligible
    || !diagnostic.enabled
  ) {
    const skipDiagnostic = buildSafeReadShadowDiagnostic(diagnostic, { action: 'skip' })
    logger.info?.('[AiScoreCache] read-shadow diagnostic', skipDiagnostic)
    return { checked: false, hit: false, diagnostic: skipDiagnostic }
  }

  const cacheKeyResult = buildScoreCacheKey(metadata)
  const cacheKeyFingerprint = buildCacheKeyFingerprint(cacheKeyResult.key)

  try {
    const readResult = await getScoreCacheEntryReader()(cacheKeyResult.key)
    const cacheHit = Boolean(readResult?.found)
    const cachedScore = resolveNumericScore(readResult?.entry?.canonical_score)
    const currentScore = resolveNumericScore(buildScoreCacheValue(candidate, metadata).canonical_score)
    const canCompare = cacheHit && cachedScore !== null && currentScore !== null
    const scoreDelta = canCompare ? cachedScore - currentScore : null
    const readDiagnostic = buildSafeReadShadowDiagnostic(diagnostic, {
      action: cacheHit ? 'read_shadow_hit' : 'read_shadow_miss',
      cache_hit: cacheHit,
      same_score: canCompare ? scoreDelta === 0 : null,
      score_delta: canCompare ? scoreDelta : null,
      cache_key_fingerprint: cacheKeyFingerprint,
    })
    logger.info?.('[AiScoreCache] read-shadow diagnostic', readDiagnostic)
    return { checked: true, hit: cacheHit, diagnostic: readDiagnostic, entry: readResult?.entry || null }
  } catch (error) {
    const failedDiagnostic = buildSafeReadShadowDiagnostic(diagnostic, {
      action: 'read_shadow_failed_open',
      cache_hit: false,
      cache_key_fingerprint: cacheKeyFingerprint,
    })
    logger.warn?.('[AiScoreCache] read-shadow diagnostic', failedDiagnostic)
    return { checked: true, hit: false, diagnostic: failedDiagnostic, error }
  }
}

export async function writeAiScoreCacheShadow({
  candidate,
  preparedResumePayload,
  jobDescriptionContext,
  userId,
  analysisId,
  aiResponse,
  logger = console,
  env = process.env,
} = {}) {
  const metadata = buildScoreCacheMetadata({
    candidate,
    preparedResumePayload,
    jobDescriptionContext,
    userId,
    analysisId,
    aiResponse,
  })
  const scoringContractVersion = metadata.scoringContractVersion
  const diagnostic = buildScoreCacheRuntimeDiagnostic(metadata, env)

  if (scoringContractVersion !== SCORE_CACHE_SCORING_CONTRACT_VERSION) {
    const skipDiagnostic = {
      ...diagnostic,
      eligible: false,
      action: 'skip',
      reason: 'missing_or_unsupported_scoring_contract_version',
    }
    logger.info?.('[AiScoreCache] write-only shadow diagnostic', skipDiagnostic)
    return { stored: false, diagnostic: skipDiagnostic }
  }

  if (!diagnostic.has_runtime_allowlist) {
    const skipDiagnostic = { ...diagnostic, eligible: false, action: 'skip', reason: 'missing_runtime_allowlist' }
    logger.info?.('[AiScoreCache] write-only shadow diagnostic', skipDiagnostic)
    return { stored: false, diagnostic: skipDiagnostic }
  }

  if (!diagnostic.runtime_allowlist_matched || !diagnostic.key_build_eligible || !diagnostic.enabled) {
    const skipDiagnostic = { ...diagnostic, eligible: false, action: 'skip' }
    logger.info?.('[AiScoreCache] write-only shadow diagnostic', skipDiagnostic)
    return { stored: false, diagnostic: skipDiagnostic }
  }

  const cacheKeyResult = buildScoreCacheKey(metadata)
  const cacheValue = buildScoreCacheValue(candidate, metadata)
  const storagePayload = buildSafeScoreCacheStoragePayload(cacheKeyResult, cacheValue, {
    schema_version: 1,
    source: 'parse_resume_job_write_only_shadow',
    cache_key_version: diagnostic.cache_key_version,
    scoring_contract_version: diagnostic.scoring_contract_version,
  })

  if (!storagePayload.valid) {
    const invalidDiagnostic = { ...diagnostic, action: 'skip', missing_storage_fields: storagePayload.missingFields }
    logger.info?.('[AiScoreCache] write-only shadow diagnostic', invalidDiagnostic)
    return { stored: false, diagnostic: invalidDiagnostic }
  }

  try {
    await getUpsertScoreCacheEntry()(storagePayload.payload)
    logger.info?.('[AiScoreCache] write-only shadow diagnostic', { ...diagnostic, action: 'stored' })
    return { stored: true, diagnostic }
  } catch (error) {
    logger.warn?.('[AiScoreCache] write-only shadow diagnostic', {
      ...diagnostic,
      action: 'write_failed_open',
      error: error?.message || 'unknown_error',
    })
    return { stored: false, diagnostic, error }
  }
}

function normalizeString(value) {
  if (value === null || value === undefined || typeof value === 'object') return null
  const normalized = String(value).trim()
  if (/^\[object\s+object\]$/i.test(normalized)) return null
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
  if (value === null || value === undefined || typeof value === 'object') return ''
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  if (/^\[object\s+object\]$/i.test(normalized)) return ''
  return normalized.slice(0, maxLength)
}

function clampStringArray(value, maxItems = 5, maxItemLength = 160) {
  return normalizeStringArray(value)
    .map((entry) => clampString(entry, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems)
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

function buildNormalizedCandidates(analysisResult, { resumeId, filename }) {
  if (!Array.isArray(analysisResult?.candidates)) return []

  return analysisResult.candidates.map((candidate, index) => {
    const skillsStructured = normalizeStructuredSkills(candidate?.skills)
    const fallbackSkills = normalizeSkills(candidate?.skills)
    const flattenedSkills = flattenStructuredSkills(skillsStructured)
    const resolvedSkillsFlat = flattenedSkills.length > 0 ? flattenedSkills : fallbackSkills
    const identity = resolveCanonicalCandidateIdentity(
      candidate,
      `${(resumeId || filename || 'resume').toString().toLowerCase()}-${index + 1}`,
    )
    return {
      id: identity.id,
      candidateId: identity.candidateId,
      resumeId: identity.resumeId || String(resumeId || ''),
      ...candidate,
      summary: clampString(candidate?.summary, 400),
      years_experience: normalizeNullableNumber(candidate?.years_experience),
      profile_score: normalizeNullableNumber(candidate?.profile_score),
      strengths: clampStringArray(candidate?.strengths, 5, 160),
      considerations: clampStringArray(candidate?.considerations, 5, 160),
      education: normalizeCandidateEducation(candidate?.education),
      experience: normalizeCandidateFieldArray(candidate?.experience, { fieldName: 'experience', maxItems: 30, maxItemLength: 220 }),
      projects: normalizeCandidateFieldArray(candidate?.projects, { fieldName: 'projects', maxItems: 20, maxItemLength: 200 }),
      seniority_level: normalizeString(candidate?.seniority_level),
      tags: normalizeStringArray(candidate?.tags),
      top_skills: normalizeStringArray(candidate?.top_skills).slice(0, 15),
      skills_structured: skillsStructured,
      skills: skillsStructured,
      skills_flat: normalizeStringArray(resolvedSkillsFlat).slice(0, 25),
      confidenceScores: candidate?.confidenceScores || candidate?.confidence || {},
      ai_scoring_contract_v2: normalizeAiScoringContractV2(candidate?.ai_scoring_contract_v2),
    }
  })
}

const CONFLICTING_IN_RANGE_EXPERIENCE_TEXT = /\b(?:experience|years?|yrs?)\b/i
const CONFLICTING_IN_RANGE_JUDGMENT = /\b(?:exceed(?:s|ed|ing)?|above\s+(?:the\s+)?(?:range|requirement|maximum)|below\s+(?:the\s+)?(?:range|requirement|minimum)|underqualified|overqualified|experience\s+(?:gap|shortfall)|fail(?:s|ed|ing)?\s+(?:the\s+)?experience)\b/i

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function explicitlyComparesTotalYearsToBoundary(value, evaluation) {
  const text = String(value || '')
  const candidateYears = escapeRegex(evaluation.candidateYears)
  const boundaries = [evaluation.minimumYears, evaluation.maximumYears]
    .filter((boundary) => boundary !== null)
    .map(escapeRegex)
    .join('|')
  if (!boundaries) return false

  const totalYears = new RegExp(
    `(?:\\b(?:total|overall|cumulative)\\s+(?:professional\\s+|work\\s+)?experience\\b[^.\\n]{0,60}\\b${candidateYears}\\s*(?:years?|yrs?)\\b|\\bcandidate(?:'s\\s+|\\s+has\\s+)?${candidateYears}\\s*(?:years?|yrs?)(?:\\s+of)?\\s+(?:professional\\s+|work\\s+)?experience\\b)`,
    'i',
  )
  const jdBoundary = new RegExp(
    `(?:\\b(?:minimum|maximum|required|requirement|range)\\b[^.\\n]{0,40}\\b(?:${boundaries})\\s*(?:years?|yrs?)?\\b|\\b(?:${boundaries})\\s*(?:years?|yrs?)\\b[^.\\n]{0,40}\\b(?:minimum|maximum|required|requirement|range)\\b)`,
    'i',
  )
  return totalYears.test(text) && jdBoundary.test(text)
}

function reconcileCandidateExperienceRange(candidate, jobDescriptionContext) {
  const evaluation = evaluateExperienceRange(candidate?.years_experience, {
    min: jobDescriptionContext?.experienceMin,
    max: jobDescriptionContext?.experienceMax,
  })
  const next = { ...candidate, experience_range: evaluation }
  if (evaluation.classification !== 'within_range') return next

  const conflicts = (value) => CONFLICTING_IN_RANGE_EXPERIENCE_TEXT.test(String(value || ''))
    && CONFLICTING_IN_RANGE_JUDGMENT.test(String(value || ''))
    && explicitlyComparesTotalYearsToBoundary(value, evaluation)
  const filter = (values) => Array.isArray(values) ? values.filter((entry) => !conflicts(entry)) : values
  const fit = candidate?.fit_assessment
  return {
    ...next,
    considerations: filter(candidate?.considerations),
    concerns: filter(candidate?.concerns),
    missingSkills: filter(candidate?.missingSkills),
    missingRequirementsFull: filter(candidate?.missingRequirementsFull),
    risksOrGapsFull: filter(candidate?.risksOrGapsFull),
    fit_assessment: fit ? {
      ...fit,
      missing_requirements: filter(fit.missing_requirements),
      risks_or_gaps: filter(fit.risks_or_gaps),
      notes: filter(fit.notes),
      rationale: conflicts(fit.rationale) ? '' : fit.rationale,
    } : fit,
    recommendation: conflicts(candidate?.recommendation) ? '' : candidate?.recommendation,
    recommendationFull: conflicts(candidate?.recommendationFull) ? '' : candidate?.recommendationFull,
  }
}



function normalizeAttemptMode(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeAttemptOutcome(attempt = {}) {
  if (attempt?.success === true) return 'succeeded'
  if (attempt?.success === false) return 'failed'
  return 'unknown'
}

function buildFailureAttemptMetadata(error) {
  const attempts = Array.isArray(error?.attempts) ? error.attempts : []
  return attempts.map((attempt) => ({
    provider: normalizeString(attempt?.provider),
    model: normalizeString(attempt?.model),
    mode: normalizeAttemptMode(attempt?.mode || attempt?.analysisMode),
    maxTokens: normalizeNullableNumber(attempt?.maxTokens || attempt?.max_tokens),
    outcome: normalizeAttemptOutcome(attempt),
    failureCategory: normalizeString(attempt?.failureCategory),
  }))
}

function buildFailureSummaryMetadata(error, { fileBufferBase64, jobDescriptionContext }) {
  const analysisSummary = error?.analysisSummary && typeof error.analysisSummary === 'object'
    ? error.analysisSummary
    : {}

  return {
    usedFallback: Boolean(analysisSummary.usedFallback ?? error?.usedFallback),
    usedEscalation: Boolean(analysisSummary.usedEscalation ?? error?.usedEscalation),
    finalMode: normalizeAttemptMode(analysisSummary.finalMode || error?.finalMode),
    resumeCharacterCount: Number(fileBufferBase64 ? String(fileBufferBase64).length : 0),
    hasJobDescriptionContext: Boolean(jobDescriptionContext?.hasContext),
  }
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

function isLegacyWordDocument({ filename, mimeType, originalMimeType, fileBuffer } = {}) {
  return getLegacyWordDocumentDetection({ filename, mimeType, originalMimeType, fileBuffer }).isLegacyWordDocument
}

async function prepareResumePayloadForAnalysis({ fileBufferBase64, mimeType, originalMimeType, filename, displayFilename = null, fileSize, logger = console, diagnosticsContext = {} }) {
  if (!fileBufferBase64) {
    throw new Error('Resume payload is empty')
  }

  const fileBuffer = Buffer.from(String(fileBufferBase64 || ''), 'base64')
  const baseDiagnosticsInput = {
    resumeId: diagnosticsContext?.resumeId || null,
    analysisId: diagnosticsContext?.analysisId || null,
    parseJobId: diagnosticsContext?.parseJobId || null,
    originalFilename: filename || null,
    displayFilename,
    mimeType,
    originalMimeType,
    normalizedMimeType: mimeType,
    fileSize,
    fileBuffer,
    extension: diagnosticsContext?.fileExtension || null,
  }
  const legacyWordDetection = getLegacyWordDocumentDetection({ filename, mimeType, originalMimeType, fileBuffer })

  if (legacyWordDetection.isLegacyWordDocument && !isLegacyDocExtractionEnabled()) {
    if (legacyWordDetection.hasMismatch) {
      const mismatchDiagnostics = buildSafeResumeFileDiagnostics(baseDiagnosticsInput)
      logger?.warn?.('[Parse] Legacy Word MIME/extension mismatch rejected before document extraction', {
        filenameExtension: mismatchDiagnostics.extension || null,
        filenameFingerprint: mismatchDiagnostics.originalFilenameFingerprint || null,
        fileContentFingerprint: mismatchDiagnostics.fileContentFingerprint || null,
        mimeType: mimeType || null,
        originalMimeType: originalMimeType || null,
        extension: legacyWordDetection.extension || null,
        hasOleMagic: legacyWordDetection.hasOleMagic,
      })
    }
    const error = createUnsupportedLegacyWordError({ detection: legacyWordDetection })
    error.diagnostics = {
      ...(error.diagnostics || {}),
      ...buildSafeResumeFileDiagnostics({
        ...baseDiagnosticsInput,
        extractionMethod: 'legacy_doc_rejected',
        extractedTextCharCount: 0,
      }),
    }
    logSafeResumeFileDiagnostics(logger, 'extraction_decision', error.diagnostics, 'warn')
    throw error
  }

  const preparedPayload = await prepareDocumentPayloadForAnalysis({
    fileBufferBase64,
    mimeType,
    originalMimeType,
    filename,
    displayFilename,
    fileSize,
    logger,
    diagnosticsContext,
  })

  return {
    fileBufferBase64: preparedPayload.fileBufferBase64,
    mimeType: preparedPayload.preparedMimeType || preparedPayload.mimeType || mimeType,
    filename,
    fileSize,
    resumeInputMode: preparedPayload.inputMode || preparedPayload.inputKind || 'document_file',
    extractedText: preparedPayload.extractedText || null,
    originalMimeType: preparedPayload.originalMimeType || mimeType || null,
    diagnostics: preparedPayload.diagnostics || null,
    preparedMimeType: preparedPayload.preparedMimeType || preparedPayload.mimeType || mimeType || null,
    inputKind: preparedPayload.inputKind || null,
    sourceFormat: preparedPayload.sourceFormat || null,
  }
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
    experienceMin: normalizeNullableNumber(row.experience_min ?? row.experience_years),
    experienceMax: normalizeNullableNumber(row.experience_max ?? row.experience_years),
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
      || normalized.experienceYears !== null
      || normalized.experienceMin !== null
      || normalized.experienceMax !== null,
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


function buildTokenUsageMetadata({ attempt = {}, filename, jobDescriptionContext, success }) {
  return {
    source: 'ai_primary_or_fallback_parse',
    credentialLabel: attempt?.credentialLabel || 'primary',
    providerSource: attempt?.providerSource || 'unknown',
    failureCategory: attempt?.failureCategory || null,
    failureReason: attempt?.failureReason || null,
    promptVersion: Number(attempt?.promptVersion || 1),
    promptIsDefaultFallback: Boolean(attempt?.promptIsDefaultFallback),
    success: Boolean(success),
    filename,
    jobDescriptionContextUsed: Boolean(jobDescriptionContext?.hasContext),
    jobDescriptionContextSource: jobDescriptionContext?.source || 'none',
    inputFormat: attempt?.inputDiagnostics?.sourceFormat || null,
    inputKind: attempt?.inputDiagnostics?.inputKind || null,
    promptInputMode: attempt?.inputDiagnostics?.inputMode === 'extracted_text' ? 'text_content' : (attempt?.inputDiagnostics?.inputMode === 'binary' ? 'document_file' : null),
    preparedMimeType: attempt?.inputDiagnostics?.preparedMimeType || null,
    extractedTextCharCount: Number.isFinite(Number(attempt?.inputDiagnostics?.extractedTextCharCount)) ? Number(attempt.inputDiagnostics.extractedTextCharCount) : null,
    normalizedTextCharCount: Number.isFinite(Number(attempt?.inputDiagnostics?.normalizedTextCharCount)) ? Number(attempt.inputDiagnostics.normalizedTextCharCount) : null,
    normalizedTextFingerprint: attempt?.inputDiagnostics?.normalizedTextFingerprint || null,
    extractionMethod: attempt?.inputDiagnostics?.extractionMethod || null,
    compactMode: attempt?.mode || null,
  }
}

async function persistAiSuccessTokenUsage({ aiResponse, resumeId, parseJobId, userId, jobDescriptionId, filename, jobDescriptionContext }) {
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
      parseJobId,
      userId,
      jobDescriptionId,
      provider: attempt?.provider || 'anthropic',
      model: attempt?.model || null,
      tokenUsage: attempt?.tokenUsage || { usageAvailable: false, unavailableReason: 'provider_usage_missing' },
      metadata: buildTokenUsageMetadata({ attempt, filename, jobDescriptionContext, success: attempt?.success }),
    })
  }
}

async function persistAiFailureTokenUsage({ error, resumeId, parseJobId, userId, jobDescriptionId, filename, jobDescriptionContext }) {
  const attempts = Array.isArray(error?.attempts) ? error.attempts : []
  const failedProviderAttempts = attempts.filter((attempt) => getProviderFromAttempt(attempt))

  if (isPreProviderLocalExtractionFailure(error) && failedProviderAttempts.length === 0) {
    return { persisted: 0, reason: 'pre_provider_local_extraction_failure' }
  }

  if (failedProviderAttempts.length > 0) {
    for (const attempt of failedProviderAttempts) {
      const provider = getProviderFromAttempt(attempt)
      await persistTokenUsageMetric({
        resumeId,
        parseJobId,
        userId,
        jobDescriptionId,
        provider,
        model: attempt?.model || null,
        tokenUsage: attempt?.tokenUsage || {
          usageAvailable: false,
          unavailableReason: `provider_request_failed:${normalizeUnavailableReason(error.message)}`,
        },
        metadata: buildTokenUsageMetadata({ attempt, filename, jobDescriptionContext, success: false }),
      })
    }
    return { persisted: failedProviderAttempts.length, reason: 'provider_attempts' }
  }

  const provider = getProviderFromFailureMetadata(error)
  if (!provider) {
    return { persisted: 0, reason: 'provider_not_attempted' }
  }

  await persistTokenUsageMetric({
    resumeId,
    parseJobId,
    userId,
    jobDescriptionId,
    provider,
    model: error?.model || null,
    tokenUsage: {
      usageAvailable: false,
      unavailableReason: `provider_request_failed:${normalizeUnavailableReason(error.message)}`,
    },
    metadata: {
      source: 'ai_primary_or_fallback_parse',
      promptVersion: 1,
      promptIsDefaultFallback: true,
      filename,
      jobDescriptionContextUsed: Boolean(jobDescriptionContext?.hasContext),
      jobDescriptionContextSource: jobDescriptionContext?.source || 'none',
    },
  })
  return { persisted: 1, reason: 'provider_failure_metadata' }
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

const CANCELLED_ANALYSIS_STATUSES = new Set(['cancelled', 'canceled'])

export async function isAnalysisActiveForJob({ analysisId, userId }) {
  const normalizedAnalysisId = String(analysisId || '').trim()
  if (!normalizedAnalysisId) {
    return { active: true, reason: 'no_analysis_id' }
  }

  if (!userId) {
    return { active: false, reason: 'missing_user_id' }
  }

  const result = await pool.query(
    `SELECT id, status
     FROM analyses
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [normalizedAnalysisId, userId],
  )

  const analysis = result.rows[0]
  if (!analysis) {
    return { active: false, reason: 'analysis_missing' }
  }

  const status = String(analysis.status || '').trim().toLowerCase()
  if (CANCELLED_ANALYSIS_STATUSES.has(status)) {
    return { active: false, reason: `analysis_${status}` }
  }

  return { active: true, reason: 'analysis_active' }
}

async function cancelJobForDeletedAnalysis(job, reason) {
  const cancellationPayload = {
    cancelled: true,
    reason,
    analysisId: job?.data?.analysisId || null,
  }

  await setJobState(job.id, {
    status: 'cancelled',
    progress: 100,
    error_message: 'Analysis was deleted or cancelled before parsing completed',
    result: JSON.stringify(cancellationPayload),
    attempts: job.attemptsMade + 1,
  })

  await job.progress(100)
  return cancellationPayload
}

async function cancelIfAnalysisInactive(job, checkpoint) {
  const activeState = await isAnalysisActiveForJob({
    analysisId: job?.data?.analysisId,
    userId: job?.data?.userId,
  })

  if (activeState.active) {
    return null
  }

  const reason = `${activeState.reason}:${checkpoint}`
  console.log(`[Parse] Skipping parse job ${String(job.id)} because parent analysis is inactive (${reason}).`)
  return cancelJobForDeletedAnalysis(job, reason)
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

export async function runParse(job) {
  const { resumeId, filename, originalFilename, originalMimeType, fileExtension, mimeType, fileSize, analysisId } = job.data
  const analysisFilename = originalFilename || filename
  const displayFilename = filename && filename !== analysisFilename ? filename : null
  const startedAt = Date.now()

  await setJobState(job.id, {
    status: 'processing',
    progress: 10,
    attempts: job.attemptsMade,
  })

  await job.progress(10)

  const loadedResumePayload = await withParseStageTimeout(
    loadFileBufferBase64ForParseJob({ ...job.data, jobId: job.id }, { logger: console }),
    { stage: 'document_load', timeoutMs: PARSE_STAGE_TIMEOUT_MS },
  )

  const preparedResumePayload = await withParseStageTimeout(prepareResumePayloadForAnalysis({
    fileBufferBase64: loadedResumePayload.fileBufferBase64,
    mimeType,
    originalMimeType,
    filename: analysisFilename,
    displayFilename,
    fileSize,
    logger: console,
    diagnosticsContext: {
      resumeId,
      userId: job.data.userId ?? null,
      analysisId: analysisId || null,
      parseJobId: job.id,
      fileExtension,
      fileTransport: loadedResumePayload.source,
    },
  }), { stage: 'document_extraction', timeoutMs: PARSE_STAGE_TIMEOUT_MS })

  if (preparedResumePayload.diagnostics) {
    logSafeResumeFileDiagnostics(console, 'prepared_payload', preparedResumePayload.diagnostics)
  }

  await new Promise((resolve) => setTimeout(resolve, 400))
  await setJobState(job.id, { progress: 45 })
  await job.progress(45)

  await new Promise((resolve) => setTimeout(resolve, 400))
  await setJobState(job.id, { progress: 75 })
  await job.progress(75)

  let analysisResult
  let aiResponse
  let parseMethod = 'anthropic-primary'
  let scoreContractShadowMetadata = { provider: null, model: null, promptVersion: null, mode: null }
  const jobDescriptionContext = await fetchJobDescriptionContext({
    userId: job.data.userId,
    jobDescriptionId: job.data.jobDescriptionId || null,
  })
  const aiScoringContractV2ShadowMetadata = {
    userId: job.data.userId ?? null,
    analysisId: analysisId || null,
  }
  if (jobDescriptionContext && typeof jobDescriptionContext === 'object') {
    jobDescriptionContext.__aiScoringContractV2ShadowMetadata = aiScoringContractV2ShadowMetadata
  }

  const preAiCancellation = await cancelIfAnalysisInactive(job, 'before_ai')
  if (preAiCancellation) return preAiCancellation

  try {
    console.log('[Parse] Attempting AI analysis with primary/fallback keys...')
    aiResponse = await withParseStageTimeout(getAnalyzeResumeWithConfiguredFallback()(
      preparedResumePayload.fileBufferBase64,
      preparedResumePayload.mimeType,
      preparedResumePayload.filename,
      {
        jobDescriptionContext,
        resumeInputMode: preparedResumePayload.resumeInputMode,
        diagnosticsContext: {
          pdfCanonicalExtractionObserveOnlyAlreadyEvaluated: true,
          pdfCanonicalTextScoringExperimentAlreadyEvaluated: true,
          observeOnlyEligibility: preparedResumePayload.diagnostics?.observeOnlyEligibility || null,
          pdfCanonicalExtractionObserveOnly: preparedResumePayload.diagnostics?.pdfCanonicalExtractionObserveOnly || null,
          pdfCanonicalTextScoringExperiment: preparedResumePayload.diagnostics?.pdfCanonicalTextScoringExperiment || null,
          analysisId: analysisId || null,
          resumeId,
          parseJobId: job.id,
          originalFilenameFingerprint: safeFingerprint(originalFilename || analysisFilename || filename),
          fileExtension: fileExtension || preparedResumePayload.sourceFormat || null,
          extractionMethod: preparedResumePayload.diagnostics?.extractionMethod || null,
          inputKind: preparedResumePayload.inputKind || null,
        },
      },
    ), { stage: 'ai_analysis', timeoutMs: AI_ANALYSIS_TIMEOUT_MS })
    const aiResult = aiResponse?.result || {}
    await persistAiSuccessTokenUsage({
      aiResponse,
      resumeId,
      parseJobId: job.id,
      userId: job.data.userId,
      jobDescriptionId: job.data.jobDescriptionId || null,
      filename: analysisFilename,
      jobDescriptionContext,
    }).catch((persistError) => {
      console.warn('[Parse] Failed to persist token usage metadata:', persistError.message)
    })

    const postAiCancellation = await cancelIfAnalysisInactive(job, 'after_ai')
    if (postAiCancellation) return postAiCancellation

    console.log('[Parse] AI analysis successful')
    analysisResult = aiResult
    parseMethod = aiResponse?.provider || 'anthropic-primary'
    scoreContractShadowMetadata = {
      provider: aiResponse?.provider || analysisResult?.provider || null,
      model: aiResponse?.model || analysisResult?.model || null,
      promptVersion: aiResponse?.promptVersion || analysisResult?.promptVersion || analysisResult?.prompt_version || null,
      mode: aiResponse?.mode || analysisResult?.mode || null,
    }
  } catch (aiError) {
    await persistAiFailureTokenUsage({
      error: aiError,
      resumeId,
      parseJobId: job.id,
      userId: job.data.userId,
      jobDescriptionId: job.data.jobDescriptionId || null,
      filename: analysisFilename,
      jobDescriptionContext,
    }).catch((persistError) => {
      console.warn('[Parse] Failed to persist missing token usage metadata:', persistError.message)
    })

    throw aiError
  }

  const candidates = buildNormalizedCandidates(analysisResult, { resumeId, filename: analysisFilename })
    .map((candidate) => reconcileCandidateExperienceRange(candidate, jobDescriptionContext))
  const scoredCandidates = applyJobDescriptionScoringMode(candidates, jobDescriptionContext)
  const normalizedCandidates = canonicalizeAnalysisScoreFields(scoredCandidates, { jobDescriptionContext })
  let finalCandidates = applyDeterministicJdFitScoresForRuntimeTest({
    candidates: normalizedCandidates,
    jobDescriptionContext,
    userId: job.data.userId ?? null,
    analysisId: analysisId || null,
    resumeId,
    logger: console,
  })

  const v2ShadowResult = await getAiScoringContractV2ShadowRunner()({
    resumeText: aiResponse?.shadowInput?.resumeText || '',
    jobDescriptionContext,
    userId: job.data.userId ?? null,
    analysisId: analysisId || null,
    resumeId,
    candidates: finalCandidates,
    logger: console,
    inputDiagnostics: aiResponse?.attempts?.at?.(-1)?.inputDiagnostics || null,
  })
  if (v2ShadowResult?.contract) {
    for (const candidate of finalCandidates) {
      candidate.ai_scoring_contract_v2 = v2ShadowResult.contract
    }
  }

  finalCandidates = applyAiScoringContractV2VisibleScoreExperiment({
    candidates: finalCandidates,
    userId: job.data.userId ?? null,
    analysisId: analysisId || null,
    resumeId,
    parseJobId: job.id,
    parseDiagnostics: preparedResumePayload.diagnostics || null,
    fileExtension: fileExtension || preparedResumePayload.sourceFormat || null,
    extractionMethod: preparedResumePayload.diagnostics?.extractionMethod || preparedResumePayload.diagnostics?.extraction_method || null,
    logger: console,
  })

  const finalAiAttempt = aiResponse?.attempts?.at?.(-1) || null
  const tokenBudgetAttempts = aiResponse?.tokenBudgetAttempts || finalAiAttempt?.tokenBudgetAttempts || []
  const tokenBudgetAttemptCount = Array.isArray(tokenBudgetAttempts) ? tokenBudgetAttempts.length : 0
  const finalTokenBudgetAttempt = tokenBudgetAttemptCount > 0 ? tokenBudgetAttempts[tokenBudgetAttemptCount - 1] : null
  const tokenBudgetRetryCount = tokenBudgetAttemptCount > 0 ? Math.max(0, tokenBudgetAttemptCount - 1) : null
  const retryCount = tokenBudgetRetryCount ?? Math.max(0, (aiResponse?.attempts?.length || 1) - 1)
  const finalAttemptIndex = tokenBudgetAttemptCount > 0
    ? tokenBudgetAttemptCount
    : (finalAiAttempt?.attemptNumber ?? aiResponse?.attempts?.length ?? null)

  for (const candidate of finalCandidates) {
    const scoringMetadata = {
      userId: job.data.userId ?? null,
      analysisId: analysisId || null,
      resumeId,
      ...scoreContractShadowMetadata,
    }
    emitScoreContractShadowDiagnostic(candidate, scoringMetadata)
    logAiScoringContractV2Diagnostic(candidate, scoringMetadata, console)
    emitAiScoringContractV2ScoreDeltaDiagnostic({
      candidate,
      parseDiagnostics: preparedResumePayload.diagnostics || null,
      fileExtension: fileExtension || preparedResumePayload.sourceFormat || null,
      metadata: {
        ...scoringMetadata,
        parseJobId: job.id,
        hasJobDescriptionContext: Boolean(jobDescriptionContext?.hasContext),
        originalFilename: originalFilename || analysisFilename || filename,
        provider: scoreContractShadowMetadata.provider,
        model: scoreContractShadowMetadata.model,
        promptVersion: scoreContractShadowMetadata.promptVersion,
        compactMode: scoreContractShadowMetadata.mode === 'minimal',
        retryCount,
        finalAttemptIndex,
        tokenBudgetAttemptCount: tokenBudgetAttemptCount || null,
        tokenBudgetRetryCount,
        finalTokenBudgetMaxOutputTokens: finalTokenBudgetAttempt?.maxTokens ?? aiResponse?.maxOutputTokens ?? null,
        finalTokenBudgetMode: finalTokenBudgetAttempt?.mode ?? null,
      },
      logger: console,
    })
    emitDeterministicJdFitShadowDiagnostic({
      candidate,
      jobDescriptionContext,
      userId: job.data.userId ?? null,
      analysisId: analysisId || null,
      resumeId,
      provider: scoreContractShadowMetadata.provider,
      model: scoreContractShadowMetadata.model,
      logger: console,
    })
    if (shouldSkipAiScoreCacheShadowForCandidate(candidate)) continue

    await readAiScoreCacheShadowDiagnostic({
      candidate,
      preparedResumePayload,
      jobDescriptionContext,
      userId: job.data.userId ?? null,
      analysisId: analysisId || null,
      aiResponse: scoreContractShadowMetadata,
      logger: console,
    })
    await writeAiScoreCacheShadow({
      candidate,
      preparedResumePayload,
      jobDescriptionContext,
      userId: job.data.userId ?? null,
      analysisId: analysisId || null,
      aiResponse: scoreContractShadowMetadata,
      logger: console,
    })
  }

  const parseResult = {
    filename: analysisFilename,
    originalFilename: analysisFilename,
    fileExtension: fileExtension || preparedResumePayload.sourceFormat || undefined,
    mimeType: preparedResumePayload.mimeType,
    originalMimeType: originalMimeType || preparedResumePayload.originalMimeType || undefined,
    fileSize: preparedResumePayload.fileSize,
    parserVersion: 'ai-only',
    analyzerUsed: 'AI',
    methodUsed: analysisResult?.methodUsed || parseMethod,
    ...analysisResult,
    jobDescriptionId: job.data.jobDescriptionId || null,
    parseDiagnostics: preparedResumePayload.diagnostics || null,
    jobDescriptionContextUsed: Boolean(jobDescriptionContext?.hasContext),
    jobDescriptionContextSource: jobDescriptionContext?.source || 'none',
    jobDescriptionContextMissingReason: jobDescriptionContext?.hasContext
      ? null
      : (jobDescriptionContext?.missingReason || 'job_description_missing'),
    candidates: finalCandidates,
  }

  const parseDurationMs = Date.now() - startedAt

  const prePersistCancellation = await cancelIfAnalysisInactive(job, 'before_persist')
  if (prePersistCancellation) return prePersistCancellation

  const primaryCandidate = finalCandidates[0] || null
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
         raw_text = CASE
           WHEN COALESCE($13, '') <> '' THEN $13
           ELSE COALESCE(raw_text, '')
         END
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
      preparedResumePayload.extractedText,
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

  await getCacheJobResult()(String(job.id), {
    status: 'complete',
    progress: 100,
    result: parseResult,
  })

  try {
    await triggerWebhook('parse.completed', {
      resumeId,
      userId: job.data.userId ?? null,
      candidates: parseResult?.candidates || [],
      jobDescriptionId: parseResult?.jobDescriptionId || null,
      matchScores: parseResult?.matchScores || null,
    })
  } catch (webhookError) {
    console.error('[Webhooks] Failed to trigger parse.completed webhook:', { errorType: webhookError?.name || 'Error', message: String(webhookError?.message || 'unknown').slice(0, 180) })
  }

  await job.progress(100)
  return parseResult
}

export async function handleParseJobFailure(job, error, { cacheFailureResult = cacheJobResult, logger = console } = {}) {
  const normalizedError = normalizeProviderError(error)
  const retryability = classifyParseJobRetryability(error)
  const isNonRetriableFailure =
    retryability.retryable === false || normalizedError?.isRetriable === false
  const isTerminalFailure = isTerminalJobFailure(job) || isNonRetriableFailure
  const providerChainAttempts = buildFailureAttemptMetadata(error)
  const providerChainSummary = buildFailureSummaryMetadata(error, {
    fileBufferBase64: job?.data?.fileBufferBase64,
    jobDescriptionContext: {
      hasContext: Boolean(job?.data?.jobDescriptionId),
    },
  })
  const failureDiagnostics = error?.diagnostics && typeof error.diagnostics === 'object'
    ? error.diagnostics
    : null
  if (failureDiagnostics) {
    logSafeResumeFileDiagnostics(logger, 'parse_job_failure', failureDiagnostics, 'warn')
  }
  const failurePayload = {
    error: normalizedError.normalizedMessage,
    parseDiagnostics: failureDiagnostics,
    providerChain: providerChainAttempts.length > 0
      ? {
          attempts: providerChainAttempts,
          summary: providerChainSummary,
        }
      : null,
    retryable: retryability.retryable,
    retryClassification: retryability.reason,
  }

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
    result: JSON.stringify(failurePayload),
    attempts: job.attemptsMade + 1,
  })

  if (isTerminalFailure) {
    await cacheFailureResult(String(job.id), {
      status: 'failed',
      progress: 100,
      result: failurePayload,
      error: normalizedError.normalizedMessage,
    })
  }

  if (isNonRetriableFailure) {
    job.discard()
  }

  return { failurePayload, isTerminalFailure, isNonRetriableFailure }
}

export function registerParseResumeJobProcessor() {
  parseQueue.process(async (job) => {
    try {
      return await runParse(job)
    } catch (error) {
      await handleParseJobFailure(job, error)
      throw error
    }
  })

  console.log('[Queue] Parse resume worker registered')
}

export const __testables = {
  normalizeStructuredSkills,
  buildNormalizedCandidates,
  reconcileCandidateExperienceRange,
  runParse,
  loadFileBufferBase64ForParseJob,
  withParseStageTimeout,
  isLegacyWordDocument,
  isAnalysisActiveForJob,
  isPreProviderLocalExtractionFailure,
  getProviderFromAttempt,
  persistAiFailureTokenUsage,
  persistAiSuccessTokenUsage,
  handleParseJobFailure,
  readAiScoreCacheShadowDiagnostic,
  writeAiScoreCacheShadow,
  emitDeterministicJdFitShadowDiagnostic,
  buildSafeDeterministicJdFitShadowDiagnostic,
  applyDeterministicJdFitScoresForRuntimeTest,
  buildSafeDeterministicJdFitApplyDiagnostic,
  hasDeterministicJdFitAppliedScore,
  hasV2VisibleScoreExperimentApplied,
  shouldSkipAiScoreCacheShadowForCandidate,
  logAiScoringContractV2Diagnostic,
  applyAiScoringContractV2VisibleScoreExperiment,
  buildAiScoringContractV2VisibleScoreApplyDiagnostic,
  isAiScoringContractV2VisibleApplyAllUsersEnabled,
  buildAiScoringContractV2VisibleApplyAllowlistDiagnostic,
}
