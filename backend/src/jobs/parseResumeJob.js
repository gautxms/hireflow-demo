import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { pool } from '../db/client.js'
import { cacheJobResult, parseQueue } from '../services/jobQueue.js'
import { analyzeResumeWithConfiguredFallback, canonicalizeAnalysisScoreFields } from '../services/aiResumeAnalysisService.js'
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
import { emitScoreContractShadowDiagnostic } from '../services/scoreContractShadowDiagnostics.js'
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

let analyzeResumeWithConfiguredFallbackOverrideForTests = null
let cacheJobResultOverrideForTests = null
let upsertScoreCacheEntryOverrideForTests = null
let getScoreCacheEntryOverrideForTests = null
let scoreCandidateDeterministicallyOverrideForTests = null

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

export function __setParseResumeJobTestOverrides({
  analyzeResumeWithConfiguredFallback: analyzeOverride = null,
  cacheJobResult: cacheOverride = null,
  upsertScoreCacheEntry: upsertScoreCacheEntryOverride = null,
  getScoreCacheEntry: getScoreCacheEntryOverride = null,
  scoreCandidateDeterministically: scoreCandidateDeterministicallyOverride = null,
} = {}) {
  analyzeResumeWithConfiguredFallbackOverrideForTests = analyzeOverride
  cacheJobResultOverrideForTests = cacheOverride
  upsertScoreCacheEntryOverrideForTests = upsertScoreCacheEntryOverride
  getScoreCacheEntryOverrideForTests = getScoreCacheEntryOverride
  scoreCandidateDeterministicallyOverrideForTests = scoreCandidateDeterministicallyOverride
}

export function __resetParseResumeJobTestOverrides() {
  analyzeResumeWithConfiguredFallbackOverrideForTests = null
  cacheJobResultOverrideForTests = null
  upsertScoreCacheEntryOverrideForTests = null
  getScoreCacheEntryOverrideForTests = null
  scoreCandidateDeterministicallyOverrideForTests = null
}

export function isTerminalJobFailure(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts || 1)
}

function normalizeUnavailableReason(reason) {
  const raw = String(reason || '').trim()
  return raw ? raw.slice(0, 180) : 'unknown'
}

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
    scoring_contract_version: deterministicResult?.scoring_contract_version || null,
    scoring_mode: deterministicResult?.scoring_mode || null,
    deterministic_final_score: deterministicScore,
    current_ai_score: currentAiScore,
    score_delta: deterministicScore !== null && currentAiScore !== null ? Math.round((deterministicScore - currentAiScore) * 10) / 10 : null,
    score_band: deterministicResult?.score_band || null,
    verdict: deterministicResult?.verdict || null,
    requirement_score: resolveNumericScore(breakdown.requirement_match?.score),
    skill_score: resolveNumericScore(breakdown.skill_alignment?.score),
    experience_score: resolveNumericScore(breakdown.experience_alignment?.score),
    location_score: resolveNumericScore(breakdown.location_alignment?.score),
    evidence_score: resolveNumericScore(breakdown.evidence_completeness?.score),
    risk_penalty: resolveNumericScore(breakdown.risk_penalty?.penalty),
    confidence_multiplier: resolveNumericScore(breakdown.confidence_adjustment?.multiplier),
    has_jd_context: Boolean(jobDescriptionContext?.hasContext),
    allowlist_matched: Boolean(allowlistMatched),
  }
}

export function emitDeterministicJdFitShadowDiagnostic({
  candidate,
  jobDescriptionContext,
  userId,
  analysisId,
  resumeId,
  logger = console,
  env = process.env,
} = {}) {
  if (!isDeterministicJdFitShadowEnabled(env)) return { computed: false, diagnostic: null }

  const allowlist = buildDeterministicJdFitShadowAllowlistDiagnostic({ userId, analysisId, env })
  if (!allowlist.allowlist_matched || !jobDescriptionContext?.hasContext) {
    const diagnostic = buildSafeDeterministicJdFitShadowDiagnostic({
      action: 'skip', candidate, userId, analysisId, resumeId, jobDescriptionContext, allowlistMatched: allowlist.allowlist_matched,
    })
    logger.info?.('[DeterministicJdFit] shadow diagnostic', diagnostic)
    return { computed: false, diagnostic }
  }

  try {
    const deterministicResult = getDeterministicJdFitScorer()(candidate, jobDescriptionContext)
    const diagnostic = buildSafeDeterministicJdFitShadowDiagnostic({
      action: 'computed', candidate, deterministicResult, userId, analysisId, resumeId, jobDescriptionContext, allowlistMatched: true,
    })
    logger.info?.('[DeterministicJdFit] shadow diagnostic', diagnostic)
    return { computed: true, diagnostic, deterministicResult }
  } catch (error) {
    const diagnostic = buildSafeDeterministicJdFitShadowDiagnostic({
      action: 'failed_open', candidate, userId, analysisId, resumeId, jobDescriptionContext, allowlistMatched: true,
    })
    logger.warn?.('[DeterministicJdFit] shadow diagnostic', diagnostic)
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
    }
  })
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
  const { resumeId, filename, originalFilename, originalMimeType, fileExtension, mimeType, fileSize, fileBufferBase64, analysisId } = job.data
  const analysisFilename = originalFilename || filename
  const displayFilename = filename && filename !== analysisFilename ? filename : null
  const startedAt = Date.now()

  await setJobState(job.id, {
    status: 'processing',
    progress: 10,
    attempts: job.attemptsMade,
  })

  await job.progress(10)

  const preparedResumePayload = await prepareResumePayloadForAnalysis({
    fileBufferBase64,
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
    },
  })

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
  let parseMethod = 'anthropic-primary'
  let scoreContractShadowMetadata = { provider: null, model: null, promptVersion: null, mode: null }
  const jobDescriptionContext = await fetchJobDescriptionContext({
    userId: job.data.userId,
    jobDescriptionId: job.data.jobDescriptionId || null,
  })

  const preAiCancellation = await cancelIfAnalysisInactive(job, 'before_ai')
  if (preAiCancellation) return preAiCancellation

  try {
    console.log('[Parse] Attempting AI analysis with primary/fallback keys...')
    const aiResponse = await getAnalyzeResumeWithConfiguredFallback()(
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
        },
      },
    )
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
  const scoredCandidates = applyJobDescriptionScoringMode(candidates, jobDescriptionContext)
  const normalizedCandidates = canonicalizeAnalysisScoreFields(scoredCandidates, { jobDescriptionContext })
  for (const candidate of normalizedCandidates) {
    emitScoreContractShadowDiagnostic(candidate, {
      userId: job.data.userId ?? null,
      analysisId: analysisId || null,
      resumeId,
      ...scoreContractShadowMetadata,
    })
    emitDeterministicJdFitShadowDiagnostic({
      candidate,
      jobDescriptionContext,
      userId: job.data.userId ?? null,
      analysisId: analysisId || null,
      resumeId,
      logger: console,
    })
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
    candidates: normalizedCandidates,
  }

  const parseDurationMs = Date.now() - startedAt

  const prePersistCancellation = await cancelIfAnalysisInactive(job, 'before_persist')
  if (prePersistCancellation) return prePersistCancellation

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
  runParse,
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
}
