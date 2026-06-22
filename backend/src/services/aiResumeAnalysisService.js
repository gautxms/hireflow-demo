import Anthropic from '@anthropic-ai/sdk'
import crypto from 'node:crypto'
import { logTelemetryToDatabase } from '../db/client.js'
import { getActiveAiProviderCredentials } from './aiProviderConfigService.js'
import { AI_MODEL_CONFIG } from '../config/aiModels.js'
import { getRuntimeSystemPromptConfig } from './adminSystemPromptService.js'
import { prepareResumePayloadForAnalysis } from './resumeDocumentExtractionService.js'
import { normalizeCandidateEducation } from '../utils/candidateEducation.js'
import { normalizeCandidateFieldArray } from '../utils/candidateStructuredFields.js'

const MODEL = AI_MODEL_CONFIG.defaultModel
const MAX_MONTHLY_BUDGET = Number(process.env.CLAUDE_BUDGET_LIMIT || 100)
const MIME_TYPE_MAP = {
  'application/pdf': 'application/pdf',
}
const PROVIDER_ORDER = ['anthropic', 'openai']
const OPENAI_MODEL_CAPABILITIES = {
  default: {
    supportsTemperature: false,
  },
}
const OPENAI_OUTPUT_TOKEN_LADDER = [2000, 4000, 8000]
const TOKEN_BUDGET_CONFIG = {
  anthropic: {
    primary: { standard: [2600, 3600, 4096], compact: [1800, 2600, 3600] },
    escalation: { standard: [3600, 4096, 6400], compact: [2600, 3600, 4096] },
    providerMaxOutputTokens: 6400,
  },
  openai: {
    fallback: { standard: OPENAI_OUTPUT_TOKEN_LADDER, compact: OPENAI_OUTPUT_TOKEN_LADDER },
    providerMaxOutputTokens: 8000,
  },
}
function clampTokenBudget(value, maxSupported) {
  const numeric = Number.parseInt(String(value || 0), 10)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.min(numeric, Math.max(1, Number.parseInt(String(maxSupported || 0), 10) || numeric))
}

function buildTokenBudgetLadder(baseLadder = [], maxSupported = null) {
  const deduped = []
  for (const candidate of Array.isArray(baseLadder) ? baseLadder : []) {
    const clamped = clampTokenBudget(candidate, maxSupported)
    if (!clamped || deduped.includes(clamped)) continue
    deduped.push(clamped)
  }
  return deduped.length ? deduped : [clampTokenBudget(1024, maxSupported) || 1024]
}

function isFallbackDisabledOnTruncation() {
  return String(process.env.AI_DISABLE_FALLBACK_ON_TRUNCATION || '').toLowerCase() === 'true'
}

function getMaxProviderAttemptsPerFile() {
  return Math.max(1, Number.parseInt(process.env.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE || '8', 10) || 8)
}
const DEFAULT_TEXT_PROMPT_CHAR_LIMIT = 18000
export const DEFAULT_RESUME_TEXT_PROMPT_CHAR_LIMIT = 12000
const CANDIDATE_COMPACT_SCHEMA_VERSION = 'compact-v2'

let claudeTokensUsed = {
  input: 0,
  output: 0,
  totalRequests: 0,
}

export function getClaudeTokenStats() {
  return claudeTokensUsed
}

export function resetClaudeTokenStats() {
  claudeTokensUsed = { input: 0, output: 0, totalRequests: 0 }
}


function isRawAiResponseDebugLoggingEnabled() {
  return String(process.env.AI_RAW_RESPONSE_DEBUG_LOGS || '').toLowerCase() === 'true'
}

function buildContentFingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)
}

function extractJsonParseErrorPosition(parseError) {
  const message = String(parseError?.message || '')
  const match = message.match(/position\s+(\d+)/i)
    || message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  if (!match) return null

  if (match.length >= 3) {
    return { line: Number(match[1]), column: Number(match[2]) }
  }
  return { position: Number(match[1]) }
}

function buildSafeParseDiagnostics(rawResponse, {
  provider = null,
  model = null,
  promptVersion = null,
  maxOutputTokens = null,
  completionStatus = null,
  stopReason = null,
  parseError = null,
  retryMetadata = null,
  analysisId = null,
  resumeId = null,
  parseJobId = null,
  originalFilenameFingerprint = null,
  fileExtension = null,
  extractionMethod = null,
  inputKind = null,
  promptCharCount = null,
  attemptIndex = null,
  maxAttempts = null,
} = {}) {
  const parseErrorType = parseError?.name || 'SyntaxError'
  const parseErrorCode = 'invalid_json'
  const responseCharCount = String(rawResponse || '').length
  return {
    provider,
    model,
    prompt_version: promptVersion ?? null,
    response_char_count: responseCharCount,
    parse_error_type: parseErrorType,
    parse_error_code: parseErrorCode,
    parse_error_message: parseErrorCode,
    parse_error_position: extractJsonParseErrorPosition(parseError),
    error_fingerprint: buildContentFingerprint(`${provider || 'unknown'}:${model || 'unknown'}:${parseErrorType}:${parseErrorCode}:${responseCharCount}`),
    completion_status: completionStatus || null,
    stop_reason: stopReason || null,
    max_output_tokens: maxOutputTokens ?? null,
    promptCharCount: promptCharCount ?? null,
    attempt_index: attemptIndex ?? retryMetadata?.attempt_index ?? retryMetadata?.token_budget_attempt_index ?? null,
    max_attempts: maxAttempts ?? retryMetadata?.max_attempts ?? retryMetadata?.token_budget_attempt_count ?? null,
    retry: retryMetadata || null,
    analysis_id: analysisId || null,
    resume_id: resumeId || null,
    parse_job_id: parseJobId || null,
    original_filename_fingerprint: originalFilenameFingerprint || null,
    file_extension: fileExtension || null,
    extraction_method: extractionMethod || null,
    input_kind: inputKind || null,
  }
}

function logRawAiResponseForLocalDebug(label, rawResponse) {
  if (!isRawAiResponseDebugLoggingEnabled()) return
  console.warn(`${label} (AI_RAW_RESPONSE_DEBUG_LOGS enabled; do not enable in production):`, rawResponse)
}

function sanitizeSnippet(value, maxLength = 180) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, maxLength)
}

function dedupeLinesPreserveOrder(input = '') {
  const seen = new Set()
  const lines = []
  for (const line of String(input || '').split('\n')) {
    const normalized = line.trim().toLowerCase()
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    lines.push(line.trim())
  }
  return lines
}

function clampString(value, maxLength) {
  if (value === null || value === undefined || typeof value === 'object') return ''
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  if (/^\[object\s+object\]$/i.test(normalized)) return ''
  return normalized.slice(0, maxLength)
}

function clampStringArray(values, { maxItems, maxItemLength, fieldName = '' }) {
  return normalizeCandidateFieldArray(values, { fieldName, maxItems, maxItemLength })
}



const AI_SCORING_CONTRACT_V2_VERSION = 'ai_jd_fit_rubric_v2'
const AI_SCORING_CONTRACT_V2_WEIGHTS = Object.freeze({
  skills_match_score: 0.40,
  relevant_experience_score: 0.30,
  education_relevance_score: 0.15,
  seniority_progression_score: 0.15,
})
const AI_SCORING_CONTRACT_V2_SCORE_FIELDS = Object.freeze(Object.keys(AI_SCORING_CONTRACT_V2_WEIGHTS))
const AI_SCORING_CONTRACT_V2_SAFE_ANOMALY_CODES = Object.freeze(new Set([
  'weighted_total_mismatch',
  'scoring_contract_version_mismatch',
  'v2_missing_contract',
  'v2_shadow_missing_resume_text',
  'v2_shadow_skipped_binary_input_without_text',
  'has_job_description_context_corrected',
  ...AI_SCORING_CONTRACT_V2_SCORE_FIELDS.flatMap((field) => [
    `${field}_non_numeric`,
    `${field}_out_of_range_clamped`,
  ]),
  'weighted_total_score_non_numeric',
  'weighted_total_score_out_of_range_clamped',
  'below_minimum_experience_relevant_experience_capped',
  'below_minimum_experience_seniority_capped',
  'below_minimum_experience_weighted_total_capped',
]))

function roundScoringContractScore(value) {
  return Math.round(value * 10) / 10
}

function normalizeScoringContractScore(value, fieldName, anomalies) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    anomalies.add(`${fieldName}_non_numeric`)
    return null
  }
  if (numeric < 0 || numeric > 100) {
    anomalies.add(`${fieldName}_out_of_range_clamped`)
  }
  return roundScoringContractScore(Math.max(0, Math.min(100, numeric)))
}

function extractFirstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const match = String(value).match(/-?\d+(?:\.\d+)?/)
    if (!match) continue
    const numeric = Number(match[0])
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

function getJobDescriptionMinimumExperienceYears(jobDescriptionContext = null) {
  const jd = jobDescriptionContext && typeof jobDescriptionContext === 'object' ? jobDescriptionContext : {}
  return extractFirstFiniteNumber(
    jd.minExperienceYears,
    jd.minimumExperienceYears,
    jd.min_experience_years,
    jd.minimum_experience_years,
    jd.experienceMin,
    jd.minExperience,
    jd.experienceYears,
    jd.experience_years,
  )
}

function getCandidateExperienceYears(candidate = null) {
  const value = candidate && typeof candidate === 'object' ? candidate : {}
  return extractFirstFiniteNumber(
    value.years_experience,
    value.experience_years,
    value.total_experience_years,
    value.totalYearsExperience,
    value.total_experience,
  )
}

function recomputeAiScoringContractV2Total(normalized = {}) {
  const scores = AI_SCORING_CONTRACT_V2_SCORE_FIELDS.map((field) => normalized[field])
  if (scores.some((score) => score === null || score === undefined)) return null
  return roundScoringContractScore(
    normalized.skills_match_score * AI_SCORING_CONTRACT_V2_WEIGHTS.skills_match_score
    + normalized.relevant_experience_score * AI_SCORING_CONTRACT_V2_WEIGHTS.relevant_experience_score
    + normalized.education_relevance_score * AI_SCORING_CONTRACT_V2_WEIGHTS.education_relevance_score
    + normalized.seniority_progression_score * AI_SCORING_CONTRACT_V2_WEIGHTS.seniority_progression_score,
  )
}


function buildMissingAiScoringContractV2Diagnostic({ reason = 'v2_missing_contract', scoreConfidenceReason = 'AI scoring contract v2 was requested in shadow mode but omitted by the model.' } = {}) {
  return {
    scoring_contract_version: AI_SCORING_CONTRACT_V2_VERSION,
    skills_match_score: null,
    relevant_experience_score: null,
    education_relevance_score: null,
    seniority_progression_score: null,
    weighted_total_score_from_ai: null,
    weighted_total_score_recomputed: null,
    score_confidence: 'low',
    score_confidence_reason: scoreConfidenceReason,
    scoring_anomalies: [reason],
    model_reported_anomalies: [],
    has_job_description_context: true,
  }
}

function normalizeSafeAiScoringContractV2AnomalyCodes(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((entry) => clampString(entry, 80))
    .filter((entry) => AI_SCORING_CONTRACT_V2_SAFE_ANOMALY_CODES.has(entry))
}

function normalizeModelReportedAiScoringContractV2Anomalies(values) {
  return clampStringArray(values || [], { maxItems: 20, maxItemLength: 120 })
}

function isAlreadyNormalizedAiScoringContractV2(value = {}) {
  return value?.weighted_total_score_from_ai !== undefined
    || value?.weighted_total_score_recomputed !== undefined
    || value?.model_reported_anomalies !== undefined
}

export function normalizeAiScoringContractV2(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const forceHasJobDescriptionContext = options?.hasJobDescriptionContext === true
  const alreadyNormalized = isAlreadyNormalizedAiScoringContractV2(value)
  const anomalies = new Set(alreadyNormalized ? normalizeSafeAiScoringContractV2AnomalyCodes(value?.scoring_anomalies) : [])
  const weightedTotalSource = value?.weighted_total_score !== undefined
    ? value.weighted_total_score
    : value?.weighted_total_score_from_ai
  const modelReportedAnomalies = normalizeModelReportedAiScoringContractV2Anomalies(
    value?.model_reported_anomalies !== undefined
      ? value.model_reported_anomalies
      : (alreadyNormalized ? [] : value?.scoring_anomalies),
  )
  const normalized = {
    scoring_contract_version: AI_SCORING_CONTRACT_V2_VERSION,
    skills_match_score: normalizeScoringContractScore(value?.skills_match_score, 'skills_match_score', anomalies),
    relevant_experience_score: normalizeScoringContractScore(value?.relevant_experience_score, 'relevant_experience_score', anomalies),
    education_relevance_score: normalizeScoringContractScore(value?.education_relevance_score, 'education_relevance_score', anomalies),
    seniority_progression_score: normalizeScoringContractScore(value?.seniority_progression_score, 'seniority_progression_score', anomalies),
    weighted_total_score_from_ai: normalizeScoringContractScore(weightedTotalSource, 'weighted_total_score', anomalies),
    weighted_total_score_recomputed: null,
    score_confidence: ['high', 'medium', 'low'].includes(String(value?.score_confidence || '').toLowerCase())
      ? String(value.score_confidence).toLowerCase()
      : 'low',
    score_confidence_reason: clampString(value?.score_confidence_reason || '', 300),
    scoring_anomalies: [],
    model_reported_anomalies: modelReportedAnomalies,
    has_job_description_context: forceHasJobDescriptionContext || Boolean(value?.has_job_description_context),
  }

  if (forceHasJobDescriptionContext && value?.has_job_description_context === false) {
    anomalies.add('has_job_description_context_corrected')
  }

  if (value?.scoring_contract_version && value.scoring_contract_version !== AI_SCORING_CONTRACT_V2_VERSION) {
    anomalies.add('scoring_contract_version_mismatch')
  }

  const candidateExperienceYears = getCandidateExperienceYears(options?.candidate)
  const minimumExperienceYears = getJobDescriptionMinimumExperienceYears(options?.jobDescriptionContext)
  const belowMinimumExperience = forceHasJobDescriptionContext
    && Number.isFinite(candidateExperienceYears)
    && Number.isFinite(minimumExperienceYears)
    && candidateExperienceYears < minimumExperienceYears

  if (belowMinimumExperience) {
    if (normalized.relevant_experience_score !== null && normalized.relevant_experience_score > 45) {
      normalized.relevant_experience_score = 45
      anomalies.add('below_minimum_experience_relevant_experience_capped')
    }
    if (normalized.seniority_progression_score !== null && normalized.seniority_progression_score > 50) {
      normalized.seniority_progression_score = 50
      anomalies.add('below_minimum_experience_seniority_capped')
    }
  }

  normalized.weighted_total_score_recomputed = recomputeAiScoringContractV2Total(normalized)
  if (belowMinimumExperience && normalized.weighted_total_score_recomputed !== null && normalized.weighted_total_score_recomputed > 55) {
    normalized.weighted_total_score_recomputed = 55
    anomalies.add('below_minimum_experience_weighted_total_capped')
  }
  if (normalized.weighted_total_score_recomputed === null && value?.weighted_total_score_recomputed !== undefined) {
    normalized.weighted_total_score_recomputed = normalizeScoringContractScore(
      value.weighted_total_score_recomputed,
      'weighted_total_score',
      anomalies,
    )
  }
  if (
    normalized.weighted_total_score_from_ai !== null
    && normalized.weighted_total_score_recomputed !== null
    && Math.abs(normalized.weighted_total_score_from_ai - normalized.weighted_total_score_recomputed) > 1
  ) {
    anomalies.add('weighted_total_mismatch')
  }

  normalized.scoring_anomalies = normalizeSafeAiScoringContractV2AnomalyCodes([...anomalies])
  return normalized
}


function parseAiScoringContractV2Allowlist(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function aiScoringContractV2AllowlistMatches(value, allowlist) {
  if (allowlist.length === 0) return true
  if (value === null || value === undefined || value === '') return false
  return allowlist.includes(String(value))
}

export function isAiScoringContractV2ShadowEnabled({ userId = null, analysisId = null } = {}, env = process.env) {
  if (String(env.AI_SCORING_CONTRACT_V2_SHADOW_ENABLED || '').trim().toLowerCase() !== 'true') return false

  const userAllowlist = parseAiScoringContractV2Allowlist(env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_USER_IDS)
  const analysisAllowlist = parseAiScoringContractV2Allowlist(env.AI_SCORING_CONTRACT_V2_SHADOW_ALLOWED_ANALYSIS_IDS)
  return aiScoringContractV2AllowlistMatches(userId, userAllowlist)
    && aiScoringContractV2AllowlistMatches(analysisId, analysisAllowlist)
}

function normalizeStructuredSkillsCandidateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const normalized = {
    tools_and_platforms: clampStringArray(value?.tools_and_platforms || [], { maxItems: 25, maxItemLength: 80 }),
    methodologies: clampStringArray(value?.methodologies || [], { maxItems: 25, maxItemLength: 80 }),
    domain_expertise: clampStringArray(value?.domain_expertise || [], { maxItems: 25, maxItemLength: 80 }),
    soft_skills: clampStringArray(value?.soft_skills || [], { maxItems: 25, maxItemLength: 80 }),
  }
  return normalized
}

function normalizeCandidateConfidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const output = {}
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = clampString(key, 80)
    if (!normalizedKey) continue
    const numeric = Number(raw)
    if (!Number.isFinite(numeric)) continue
    output[normalizedKey] = Math.max(0, Math.min(1, numeric))
  }
  return Object.keys(output).length ? output : null
}

function normalizeCandidateFitAssessment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const normalized = {
    has_job_description_context: Boolean(value?.has_job_description_context),
    overall_fit_score: Number.isFinite(Number(value?.overall_fit_score)) ? Math.max(0, Math.min(100, Number(value.overall_fit_score))) : null,
    matched_requirements: clampStringArray(value?.matched_requirements || [], { maxItems: 25, maxItemLength: 120 }),
    missing_requirements: clampStringArray(value?.missing_requirements || [], { maxItems: 25, maxItemLength: 120 }),
    risks_or_gaps: clampStringArray(value?.risks_or_gaps || [], { maxItems: 15, maxItemLength: 180 }),
    rationale: clampString(value?.rationale || '', 500),
    notes: clampStringArray(value?.notes || [], { maxItems: 10, maxItemLength: 180 }),
  }
  return normalized
}

function normalizeCandidateMatchScore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const breakdown = value?.breakdown && typeof value.breakdown === 'object' && !Array.isArray(value.breakdown)
    ? value.breakdown
    : null
  return {
    score: Number.isFinite(Number(value?.score)) ? Math.max(0, Math.min(100, Number(value.score))) : null,
    score_out_of_ten: Number.isFinite(Number(value?.score_out_of_ten)) ? Math.max(0, Math.min(10, Number(value.score_out_of_ten))) : null,
    fit: clampString(value?.fit || '', 80),
    reason: clampString(value?.reason || '', 500),
    breakdown,
  }
}

function normalizeCompactCandidate(candidate = {}, { minimalMode = false, aiScoringContractV2Expected = false } = {}) {
  const matchedSkills = clampStringArray(
    candidate?.matchedSkills || candidate?.fit_assessment?.matched_requirements || [],
    { maxItems: minimalMode ? 10 : 15, maxItemLength: 80 },
  )
  const missingSkills = clampStringArray(
    candidate?.missingSkills || candidate?.fit_assessment?.missing_requirements || [],
    { maxItems: minimalMode ? 5 : 10, maxItemLength: 80 },
  )
  return {
    analysis_mode: clampString(candidate?.analysis_mode || '', 40),
    id: clampString(candidate?.id || '', 120),
    name: clampString(candidate?.name || candidate?.full_name || 'Unknown Candidate', 80),
    email: clampString(candidate?.email || '', 120),
    phone: clampString(candidate?.phone || candidate?.phone_number || '', 40),
    score: Number.isFinite(Number(candidate?.score))
      ? Math.max(0, Math.min(100, Number(candidate.score)))
      : Math.max(0, Math.min(100, Number(candidate?.matchScore?.score || 0))),
    verdict: clampString(candidate?.verdict || candidate?.matchScore?.fit || 'review', 30),
    summary: clampString(candidate?.summary || candidate?.profile_summary || '', 250),
    strengths: clampStringArray(candidate?.strengths || [], { maxItems: 3, maxItemLength: 120 }),
    considerations: clampStringArray(candidate?.considerations || candidate?.concerns || [], { maxItems: 3, maxItemLength: 120 }),
    concerns: clampStringArray(
      candidate?.concerns || candidate?.fit_assessment?.risks_or_gaps || [],
      { maxItems: 3, maxItemLength: 120 },
    ),
    matchedSkills,
    missingSkills,
    skills: Array.isArray(candidate?.skills)
      ? clampStringArray(candidate.skills, { maxItems: 25, maxItemLength: 80 })
      : (typeof candidate?.skills === 'string' ? clampString(candidate.skills, 500) : (normalizeStructuredSkillsCandidateInput(candidate?.skills) || clampStringArray([...matchedSkills, ...missingSkills], { maxItems: 25, maxItemLength: 80 }))),
    top_skills: clampStringArray(candidate?.top_skills || [], { maxItems: 25, maxItemLength: 80 }),
    tags: clampStringArray(candidate?.tags || [], { maxItems: 20, maxItemLength: 80 }),
    years_experience: Number.isFinite(Number(candidate?.years_experience)) ? Math.max(0, Math.min(80, Number(candidate.years_experience))) : null,
    profile_score: Number.isFinite(Number(candidate?.profile_score)) ? Math.max(0, Math.min(100, Number(candidate.profile_score))) : null,
    seniority_level: clampString(candidate?.seniority_level || '', 80),
    experienceHighlights: minimalMode ? [] : clampStringArray(candidate?.experienceHighlights || candidate?.experience_highlights || [], { maxItems: 3, maxItemLength: 150 }),
    education: minimalMode ? [] : normalizeCandidateEducation(candidate?.education, { maxItems: 20, maxItemLength: 200 }),
    experience: minimalMode ? [] : clampStringArray(candidate?.experience || [], { fieldName: 'experience', maxItems: 30, maxItemLength: 220 }),
    certifications: minimalMode ? [] : clampStringArray(candidate?.certifications || [], { maxItems: 20, maxItemLength: 160 }),
    languages: clampStringArray(candidate?.languages || [], { maxItems: 20, maxItemLength: 80 }),
    projects: minimalMode ? [] : clampStringArray(candidate?.projects || [], { fieldName: 'projects', maxItems: 20, maxItemLength: 200 }),
    achievements: minimalMode ? [] : clampStringArray(candidate?.achievements || [], { maxItems: 20, maxItemLength: 200 }),
    location: clampString(candidate?.location || '', 120),
    fit_assessment: minimalMode ? normalizeCandidateFitAssessment(candidate?.fit_assessment) : normalizeCandidateFitAssessment(candidate?.fit_assessment),
    matchScore: normalizeCandidateMatchScore(candidate?.matchScore),
    confidence: normalizeCandidateConfidence(candidate?.confidence),
    confidenceScores: normalizeCandidateConfidence(candidate?.confidenceScores),
    evidenceSnippets: [],
    recommendation: clampString(candidate?.recommendation || candidate?.matchScore?.reason || '', 160),
    filename: clampString(candidate?.filename || '', 180),
    resumeId: clampString(candidate?.resumeId || candidate?.resume_id || '', 100),
    ai_scoring_contract_v2: normalizeAiScoringContractV2(candidate?.ai_scoring_contract_v2)
      || (aiScoringContractV2Expected ? buildMissingAiScoringContractV2Diagnostic() : null),
  }
}

function normalizeCompactAnalysis(result = {}, { minimalMode = false, aiScoringContractV2Expected = false } = {}) {
  const sourceCandidates = result?.candidates
  return {
    ...result,
    candidates: Array.isArray(sourceCandidates)
      ? sourceCandidates.slice(0, 20).map((candidate) => normalizeCompactCandidate(candidate, { minimalMode, aiScoringContractV2Expected }))
      : sourceCandidates,
  }
}


const CANONICAL_SCORE_FIELDS_VERSION = 'canonical_score_fields_v1'

function isScoreFieldCanonicalizationEnabled(env = process.env) {
  return String(env.AI_CANONICALIZE_SCORE_FIELDS || '').toLowerCase() === 'true'
}

function normalizeCanonicalScore(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : null
}

function roundScoreOutOfTen(score) {
  return Math.round((score / 10) * 10) / 10
}

function hasObjectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function resolveCanonicalScore(candidate = {}, hasJobDescriptionContext = false) {
  if (hasJobDescriptionContext) {
    const matchScore = normalizeCanonicalScore(candidate?.matchScore?.score)
    if (matchScore !== null) {
      return {
        score: matchScore,
        source: 'matchScore.score',
        context: 'jd_fit',
      }
    }

    const candidateScore = normalizeCanonicalScore(candidate?.score)
    return {
      score: candidateScore,
      source: candidateScore === null ? 'missing' : 'candidate.score',
      context: 'jd_fit',
    }
  }

  const profileScore = normalizeCanonicalScore(candidate?.profile_score)
  return {
    score: profileScore,
    source: profileScore === null ? 'missing' : 'profile_score',
    context: 'profile_only',
  }
}

export function canonicalizeCandidateScoreFields(candidate = {}, { jobDescriptionContext = null, env = process.env } = {}) {
  if (!isScoreFieldCanonicalizationEnabled(env)) return candidate

  const hasJobDescriptionContext = Boolean(jobDescriptionContext?.hasContext)
  const { score, source, context } = resolveCanonicalScore(candidate, hasJobDescriptionContext)
  const nextCandidate = {
    ...candidate,
    scoring_contract_version: CANONICAL_SCORE_FIELDS_VERSION,
    canonical_score_source: source,
    canonical_score_context: context,
  }

  if (score === null) {
    return nextCandidate
  }

  nextCandidate.score = score

  if (hasJobDescriptionContext) {
    nextCandidate.matchScore = {
      ...(hasObjectValue(candidate?.matchScore) ? candidate.matchScore : {}),
      score,
      score_out_of_ten: roundScoreOutOfTen(score),
    }

    if (hasObjectValue(candidate?.fit_assessment)) {
      nextCandidate.fit_assessment = {
        ...candidate.fit_assessment,
        overall_fit_score: score,
      }
    }
  }

  return nextCandidate
}

export function canonicalizeAnalysisScoreFields(candidates = [], options = {}) {
  if (!isScoreFieldCanonicalizationEnabled(options.env)) return candidates
  if (!Array.isArray(candidates)) return candidates
  return candidates.map((candidate) => canonicalizeCandidateScoreFields(candidate, options))
}

function createProviderResponseFormatError({
  category = 'response_format_error',
  provider = null,
  model = null,
  technicalDetails = 'Provider returned malformed JSON output.',
}) {
  const serialized = JSON.stringify({
    technicalDetails: sanitizeSnippet(technicalDetails),
    provider: provider || null,
    model: model || null,
  })
  return new Error(`${category}::${serialized}`)
}

function buildPayloadKeySummary(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'payload_type=non_object'
  }
  return `keys=${Object.keys(payload).slice(0, 10).join(',') || 'none'}`
}

function findFirstJsonObjectBlock(text = '') {
  const input = String(text || '')
  const start = input.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < input.length; index += 1) {
    const char = input[index]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return input.slice(start, index + 1).trim()
      }
    }
  }
  return null
}

function isLikelyTruncatedResponse(text = '', { stopReason = null } = {}) {
  const normalizedStopReason = String(stopReason || '').toLowerCase()
  if (['max_tokens', 'length', 'model_context_window_exceeded'].includes(normalizedStopReason)) {
    return true
  }

  const trimmed = String(text || '').trim()
  if (!trimmed) return false
  const openBraces = (trimmed.match(/{/g) || []).length
  const closeBraces = (trimmed.match(/}/g) || []).length
  const openBrackets = (trimmed.match(/\[/g) || []).length
  const closeBrackets = (trimmed.match(/]/g) || []).length
  const hasUnclosedFence = trimmed.includes('```') && (trimmed.match(/```/g) || []).length % 2 === 1
  return openBraces > closeBraces || openBrackets > closeBrackets || hasUnclosedFence
}

export function safeParseAIResponse(rawResponse, context = {}) {
  let text = String(rawResponse || '').trim()
  text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '')
  text = text.replace(/^```\s*/i, '').replace(/\s*```$/i, '')
  try {
    return JSON.parse(text)
  } catch (error) {
    const invalidJsonError = new Error('AI returned invalid JSON')
    invalidJsonError.name = 'AIResponseJsonParseError'
    invalidJsonError.cause = error
    invalidJsonError.safeParseDiagnostics = buildSafeParseDiagnostics(rawResponse, { ...context, parseError: error })
    throw invalidJsonError
  }
}

export function extractJsonWithContext(text = '', { provider = null, model = null, promptVersion = null, maxOutputTokens = null, completionStatus = null, stopReason = null, retryMetadata = null, analysisId = null, resumeId = null, parseJobId = null, originalFilenameFingerprint = null, fileExtension = null, extractionMethod = null, inputKind = null, promptCharCount = null, attemptIndex = null, maxAttempts = null } = {}) {
  const trimmed = String(text || '').trim()
  if (!trimmed) {
    throw createProviderResponseFormatError({
      provider,
      model,
      technicalDetails: 'Provider returned an empty response body.',
    })
  }

  const parseCandidates = []
  parseCandidates.push(trimmed)

  const fenceBodies = []
  const fencePattern = /```(?:[a-z0-9_-]+)?[ \t]*\n?([\s\S]*?)```/ig
  let fencedMatch = fencePattern.exec(trimmed)
  while (fencedMatch) {
    if (fencedMatch?.[1]) {
      fenceBodies.push(fencedMatch[1].trim())
    }
    fencedMatch = fencePattern.exec(trimmed)
  }

  const hasAnyFence = trimmed.includes('```')
  const hasClosedFence = fenceBodies.length > 0
  if (hasAnyFence && !hasClosedFence) {
    const lastFenceIndex = trimmed.lastIndexOf('```')
    const afterFence = trimmed.slice(lastFenceIndex + 3)
    const firstNewlineIndex = afterFence.indexOf('\n')
    const fencedBody = firstNewlineIndex === -1
      ? afterFence
      : afterFence.slice(firstNewlineIndex + 1)
    if (fencedBody.trim()) {
      fenceBodies.push(fencedBody.trim())
    }
  }
  parseCandidates.push(...fenceBodies)

  const firstObjectBlock = findFirstJsonObjectBlock(trimmed)
  if (firstObjectBlock) {
    parseCandidates.push(firstObjectBlock)
  }

  const uniqueCandidates = [...new Set(parseCandidates.filter(Boolean))]
  let lastError = null
  for (const candidate of uniqueCandidates) {
    try {
      return safeParseAIResponse(candidate, { provider, model, promptVersion, maxOutputTokens, completionStatus, stopReason, retryMetadata, analysisId, resumeId, parseJobId, originalFilenameFingerprint, fileExtension, extractionMethod, inputKind, promptCharCount, attemptIndex, maxAttempts })
    } catch (error) {
      lastError = error
    }
  }

  const diagnostics = lastError?.safeParseDiagnostics || buildSafeParseDiagnostics(trimmed, { provider, model, promptVersion, maxOutputTokens, completionStatus, stopReason, retryMetadata, analysisId, resumeId, parseJobId, originalFilenameFingerprint, fileExtension, extractionMethod, inputKind, promptCharCount, attemptIndex, maxAttempts, parseError: lastError })
  console.warn('[AI Parse] Provider JSON parse failed:', diagnostics)
  logRawAiResponseForLocalDebug('[AI Parse] Raw provider response before parse failure', trimmed)
  throw createProviderResponseFormatError({
    provider,
    model,
    technicalDetails: `Unable to parse provider JSON response (${sanitizeSnippet(lastError?.message || 'invalid_json')}; fingerprint=${diagnostics.error_fingerprint}; response_char_count=${diagnostics.response_char_count}).`,
  })
}

function extractTextFromOpenAiContentNode(node) {
  if (!node || typeof node !== 'object') {
    return []
  }

  const chunks = []
  const directText = [node.output_text, node.text, node.value]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  chunks.push(...directText)

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      chunks.push(...extractTextFromOpenAiContentNode(child))
    }
  }

  return chunks
}

export function extractOpenAiResponseText(payload) {
  const directOutputText = String(payload?.output_text || '').trim()
  if (directOutputText) {
    return directOutputText
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : []
  const collectedText = []
  for (const outputNode of outputs) {
    collectedText.push(...extractTextFromOpenAiContentNode(outputNode))
  }

  return collectedText
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

async function sendBudgetAlert({ currentCost, limit }) {
  await logTelemetryToDatabase('claude.budget.alert', {
    currentCost,
    limit,
    percentageUsed: limit > 0 ? Number(((currentCost / limit) * 100).toFixed(1)) : null,
    loggedAt: new Date().toISOString(),
  }).catch(() => {})
}

async function checkBudgetAlert(estimatedCost) {
  if (MAX_MONTHLY_BUDGET <= 0) {
    return
  }

  if (estimatedCost > MAX_MONTHLY_BUDGET * 0.8) {
    console.warn('[Claude] Budget approaching limit:', {
      estimated: estimatedCost,
      limit: MAX_MONTHLY_BUDGET,
      percentageUsed: ((estimatedCost / MAX_MONTHLY_BUDGET) * 100).toFixed(1),
    })

    await sendBudgetAlert({
      currentCost: estimatedCost,
      limit: MAX_MONTHLY_BUDGET,
    }).catch(() => {})
  }
}

async function trackTokens(usage = {}, resumeId = 'unknown') {
  claudeTokensUsed.input += usage.input_tokens || 0
  claudeTokensUsed.output += usage.output_tokens || 0
  claudeTokensUsed.totalRequests += 1

  const inputCost = ((usage.input_tokens || 0) / 1000) * 0.003
  const outputCost = ((usage.output_tokens || 0) / 1000) * 0.015
  const totalCost = inputCost + outputCost
  const totalCostThisSession = (claudeTokensUsed.input / 1000) * 0.003 + (claudeTokensUsed.output / 1000) * 0.015

  console.log('[Claude] Tokens:', {
    resumeId,
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    estimatedCost: `$${totalCost.toFixed(4)}`,
    totalCostThisSession: `$${totalCostThisSession.toFixed(4)}`,
  })

  await logTelemetryToDatabase('claude.token_usage', {
    resumeId,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    estimatedCost: totalCost,
    totalCostThisSession,
    loggedAt: new Date().toISOString(),
  }).catch(() => {})

  await checkBudgetAlert(totalCostThisSession)
}

function normalizeUsageMetrics(usage, provider = 'anthropic') {
  if (!usage) {
    return {
      usageAvailable: false,
      unavailableReason: 'provider_usage_missing',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    }
  }

  const inputTokens = Number(usage.input_tokens ?? usage.input_tokens_total ?? usage.prompt_tokens ?? usage.inputTokens)
  const outputTokens = Number(usage.output_tokens ?? usage.output_tokens_total ?? usage.completion_tokens ?? usage.outputTokens)
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return {
      usageAvailable: false,
      unavailableReason: 'provider_usage_invalid',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    }
  }

  const estimatedCostUsd = provider === 'anthropic'
    ? (inputTokens / 1000) * 0.003 + (outputTokens / 1000) * 0.015
    : null

  return {
    usageAvailable: true,
    unavailableReason: null,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimatedCostUsd === null ? null : Number(estimatedCostUsd.toFixed(6)),
  }
}

function extractProviderAndModelContext(message, attemptHistory = []) {
  const recentFailure = [...attemptHistory].reverse().find((attempt) => attempt && !attempt.success)
  if (recentFailure) {
    const providerLabel = String(recentFailure.provider || '').trim()
    const provider = providerLabel.includes('-') ? providerLabel.split('-')[0] : providerLabel || null
    return {
      provider,
      model: String(recentFailure.model || '').trim() || null,
    }
  }

  const lower = String(message || '').toLowerCase()
  const provider = lower.includes('anthropic')
    ? 'anthropic'
    : lower.includes('openai')
      ? 'openai'
      : null
  const modelMatch = String(message || '').match(/model(?:\s+name)?(?:\s+is|\s*=|:)?\s*["']?([a-z0-9][a-z0-9._:-]+)["']?/i)
  return {
    provider,
    model: modelMatch?.[1] ? String(modelMatch[1]).trim() : null,
  }
}

function normalizeProviderError(error, attemptHistory = []) {
  const message = String(error?.message || 'Unknown provider error').trim()
  const lower = message.toLowerCase()
  const { provider, model } = extractProviderAndModelContext(message, attemptHistory)

  const format = (category) => `${category}::${JSON.stringify({ technicalDetails: message, provider, model })}`

  if (lower.includes('response_truncated_error') || lower.includes('output was truncated') || lower.includes('max_tokens') || lower.includes('max_output_tokens')) {
    return format('response_truncated_error')
  }
  if (lower.includes('response_format_error')) {
    return format('response_format_error')
  }
  if (lower.includes('not_found_error') || lower.includes('model not found') || lower.includes('resource not found') || lower.includes('404')) {
    return format('not_found_error')
  }
  if (lower.includes('invalid_request_error') || lower.includes('invalid request') || lower.includes('unsupported model')) {
    return format('invalid_request_error')
  }
  if (lower.includes('authentication') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('401')) {
    return format('auth_error')
  }
  if (
    lower.includes('insufficient_quota')
    || lower.includes('quota exceeded')
    || lower.includes('exceeded your current quota')
    || lower.includes('billing')
    || lower.includes('check your plan and billing details')
  ) {
    return format('billing_quota_error')
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return format('rate_limit_error')
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return format('timeout_error')
  }
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('econnreset')) {
    return format('network_error')
  }

  return format('unknown_error')
}

function createAttemptRecord({
  success,
  provider,
  keyLabel,
  model,
  providerSource,
  promptVersion,
  promptIsDefaultFallback,
  tokenUsage,
  mode = null,
  schemaVersion = CANDIDATE_COMPACT_SCHEMA_VERSION,
  maxOutputTokens = null,
  promptCharCount = null,
  resumeCharCount = null,
  jdCharCount = null,
  failureCategory = null,
  failureReason = null,
  retryPolicy = null,
  retryReason = null,
  statusCode = null,
  tokenBudgetAttempts = [],
  complexityEstimator = null,
  role = null,
  attemptNumber = null,
  normalizedReason = null,
  inputDiagnostics = null,
}) {
  return {
    success: Boolean(success),
    provider: `${provider}-${keyLabel}`,
    model,
    credentialLabel: keyLabel,
    providerSource,
    promptVersion,
    promptIsDefaultFallback,
    tokenUsage,
    mode,
    schemaVersion,
    maxOutputTokens,
    promptCharCount,
    resumeCharCount,
    jdCharCount,
    failureCategory,
    failureReason,
    retryPolicy,
    retryReason,
    statusCode,
    tokenBudgetAttempts: Array.isArray(tokenBudgetAttempts) ? tokenBudgetAttempts : [],
    complexityEstimator: complexityEstimator && typeof complexityEstimator === 'object' ? complexityEstimator : null,
    role,
    attemptNumber: Number.isFinite(Number(attemptNumber)) ? Number(attemptNumber) : null,
    normalizedReason,
    inputDiagnostics: inputDiagnostics && typeof inputDiagnostics === 'object' ? inputDiagnostics : null,
  }
}

function estimateAnalysisComplexity({ mimeType, cleanedResumeCharCount, jdCharCount, inputMode }) {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase() || 'unknown'
  const normalizedInputMode = String(inputMode || '').trim().toLowerCase() || 'binary'
  const resumeChars = Number.isFinite(Number(cleanedResumeCharCount)) ? Number(cleanedResumeCharCount) : 0
  const jdChars = Number.isFinite(Number(jdCharCount)) ? Number(jdCharCount) : 0

  const resumeScore = resumeChars >= 32000 ? 3 : resumeChars >= 20000 ? 2 : resumeChars >= 9000 ? 1 : 0
  const jdScore = jdChars >= 14000 ? 2 : jdChars >= 7000 ? 1 : 0
  const mimeScore = normalizedMimeType === 'application/pdf' ? 1 : 0
  const inputModeScore = normalizedInputMode === 'text' ? 0 : 1
  const totalScore = resumeScore + jdScore + mimeScore + inputModeScore

  const recommendedMode = totalScore >= 4 ? 'COMPACT_MINIMAL' : 'COMPACT_STANDARD'

  return {
    recommendedMode,
    totalScore,
    factors: {
      resumeChars,
      jdChars,
      mimeType: normalizedMimeType,
      inputMode: normalizedInputMode,
    },
    advisoryOnly: true,
  }
}

function createTerminalProviderError(lastError, attemptHistory) {
  const normalizedMessage = lastError
    ? normalizeProviderError(lastError, attemptHistory)
    : 'unknown_error::All configured AI providers failed.'
  const terminalError = new Error(normalizedMessage)
  terminalError.attempts = attemptHistory
  terminalError.cause = lastError || null
  return terminalError
}

function getFailureCategory(message = '') {
  const normalized = String(message || '').trim()
  const match = normalized.match(/^(response_format_error|response_truncated_error|not_found_error|invalid_request_error|auth_error|billing_quota_error|rate_limit_error|timeout_error|network_error|unknown_error)(::|$)/i)
  return match?.[1] ? String(match[1]).toLowerCase() : 'unknown_error'
}

function normalizeFailureReasonForRetry(errorLike) {
  const visited = new Set()
  const queue = [errorLike]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)

    const message = String(current?.message || current || '').trim()
    const lower = message.toLowerCase()
    if (
      lower.includes('response_truncated_error')
      || lower.includes('max_output_tokens')
      || lower.includes('max_tokens')
      || lower.includes('stop_reason=max_tokens')
      || lower.includes('incomplete_details')
    ) return 'response_truncated_error'
    if (lower.includes('response_format_error')) return 'response_format_error'
    if (lower.includes('invalid_json') || lower.includes('not valid json') || lower.includes('unexpected token')) return 'invalid_json'
    if (lower.includes('extraction_empty') || lower.includes('no parseable resume content')) return 'extraction_empty'
    if (lower.includes('auth_error')) return 'provider_auth_error'
    if (lower.includes('rate_limit_error')) return 'provider_rate_limit'
    if (lower.includes('timeout_error') || lower.includes('network_error')) return 'provider_timeout'

    const match = message.match(/^[a-z_]+::\s*(\{.*\})$/s)
    if (match?.[1]) {
      try {
        const parsed = JSON.parse(match[1])
        if (parsed?.technicalDetails) queue.push({ message: String(parsed.technicalDetails) })
      } catch {}
    }
    if (current?.cause) queue.push(current.cause)
  }

  const normalized = normalizeProviderError(errorLike)
  const category = getFailureCategory(normalized)
  if (category === 'auth_error') return 'provider_auth_error'
  if (category === 'rate_limit_error') return 'provider_rate_limit'
  if (category === 'timeout_error' || category === 'network_error') return 'provider_timeout'
  return category || 'unknown_error'
}


function extractStatusCodeFromError(error) {
  const directStatus = Number(error?.status ?? error?.statusCode ?? error?.code)
  if (Number.isInteger(directStatus) && directStatus >= 100 && directStatus <= 599) {
    return directStatus
  }

  const message = String(error?.message || '')
  const statusMatch = message.match(/\bstatus\s*(?:code)?\s*[:=]?\s*(\d{3})\b/i) || message.match(/\b(\d{3})\b/)
  const parsed = Number(statusMatch?.[1])
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null
}

function isOverloadFailure({ failureCategory, normalizedMessage, statusCode }) {
  const lower = String(normalizedMessage || '').toLowerCase()
  if (statusCode === 529 || statusCode === 503) return true
  if (failureCategory === 'rate_limit_error' && statusCode === 429) return true
  if (lower.includes('overloaded') || lower.includes('overload') || lower.includes('server is busy') || lower.includes('capacity')) return true
  return false
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function providerSupportsMimeType(provider, mimeType, inputKind = null, extractedText = null) {
  const normalizedProvider = String(provider || '').trim().toLowerCase()
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase()
  const normalizedInputKind = String(inputKind || '').trim().toLowerCase()
  if (normalizedProvider === 'anthropic') {
    if (normalizedInputKind === 'extracted_text') {
      return String(extractedText || '').trim().length > 0
    }
    if (normalizedInputKind === 'pdf_binary') {
      return normalizedMimeType === 'application/pdf'
    }
    return ['application/pdf'].includes(normalizedMimeType)
  }
  return true
}

export function buildProviderAttemptPlan(credentials = {}) {
  const activeProvider = String(credentials?.activeProvider || 'anthropic').trim().toLowerCase()
  const providers = credentials?.providers && typeof credentials.providers === 'object' ? credentials.providers : {}
  const secondaryProviders = PROVIDER_ORDER.filter((provider) => provider !== activeProvider)
  const orderedProviders = [activeProvider, ...secondaryProviders].filter((provider, index, list) => list.indexOf(provider) === index)

  const plan = []
  for (const provider of orderedProviders) {
    const providerConfig = providers?.[provider]
    if (!providerConfig || typeof providerConfig !== 'object') continue

    for (const keyLabel of ['primary', 'fallback']) {
      const candidate = providerConfig?.[keyLabel]
      if (!candidate?.apiKey) continue

      plan.push({
        provider,
        keyLabel,
        apiKey: candidate.apiKey,
        model: candidate.model || MODEL,
        source: candidate.source || 'unknown',
      })
    }
  }

  return plan
}

function normalizePrompt(value) {
  return String(value || '').trim()
}

function formatScalar(value) {
  if (value === null || value === undefined) {
    return null
  }
  const formatted = String(value).trim()
  return formatted || null
}

function formatArray(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }

  const normalized = values
    .map((value) => formatScalar(value))
    .filter(Boolean)

  return normalized.length > 0 ? normalized.join(', ') : null
}

function buildAnalysisModeDirectives(jobDescriptionContext = null) {
  const hasJobDescription = Boolean(jobDescriptionContext?.hasContext)

  if (hasJobDescription) {
    return [
      'Analysis Mode: WITH_JOB_DESCRIPTION',
      'Contract:',
      '- Perform resume extraction and JD-aware fit analysis.',
      '- Map candidate evidence to JD requirements and skills.',
      '- Include fit rationale and shortlisting signal strengths/risks in your JSON fields.',
      '- Keep output JSON-compatible with existing schema.',
    ].join('\n')
  }

  return [
    'Analysis Mode: WITHOUT_JOB_DESCRIPTION',
    'Contract:',
    '- Perform resume extraction only (no JD fit scoring assumptions).',
    '- Provide comparative shortlist signals derived from resume evidence (seniority, skills depth, impact, role alignment confidence).',
    '- Mark missing JD context clearly using "job_description_missing" in rationale/notes fields when present.',
    '- Keep output JSON-compatible with existing schema.',
  ].join('\n')
}

function buildCompactOutputInstructions({ compactMode = false, truncationSafeMode = false, bareMinimumMode = false } = {}) {
  const modeLabel = bareMinimumMode
    ? 'BARE_MINIMUM'
    : (truncationSafeMode ? 'COMPACT_TRUNCATION_SAFE' : (compactMode ? 'COMPACT_MINIMAL' : 'COMPACT_STANDARD'))
  return [
    `Output Mode: ${modeLabel}`,
    'Return compact JSON only. No markdown. No text before or after JSON.',
    'Never repeat resume text or job description text verbatim.',
    'Keep every string concise. If uncertain, return fewer items rather than longer text.',
    'Prefer empty arrays over verbose explanations.',
    'Response must complete valid JSON within the token budget.',
    bareMinimumMode
      ? 'Return at most 2 candidates. Required per candidate: {name<=60,score,summary<=100,matchedSkills<=4,recommendation<=90,analysis_mode="bare_minimum"}. Optional only: {strengths<=1,concerns<=1,missingSkills<=2}. Omit all other fields.'
      : truncationSafeMode
      ? 'Return at most 3 candidates. Use minimal schema only: {name,score,summary<=140,strengths<=2,concerns<=2,matchedSkills<=6,missingSkills<=3,recommendation<=120}. Omit all optional fields.'
      : (compactMode
        ? 'Return at most 5 candidates. Minimal schema per candidate: {name,score,summary<=250,strengths<=3,concerns<=3,matchedSkills<=10,missingSkills<=5,recommendation<=160}.'
        : 'Return at most 10 candidates. Compact schema per candidate: {name,email,phone,score,verdict,summary<=250,strengths<=3,concerns<=3,matchedSkills<=10,missingSkills<=5,skills<=25,recommendation<=160,filename,resumeId}.'),
    'Do not include evidence snippets, full work history, full resume text, or full job description text.',
    'If output risks truncation, omit optional fields first (email, phone, filename, resumeId, skills).',
  ].join('\n')
}

export function cleanExtractedTextForPrompt(text, { maxChars = DEFAULT_TEXT_PROMPT_CHAR_LIMIT } = {}) {
  const original = String(text || '')
  const lines = dedupeLinesPreserveOrder(
    original
      .replace(/\u0000/g, ' ')
      .replace(/\uFFFD/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/\r/g, '\n'),
  )
  const cleaned = lines
    .filter((line) => !/^page\s+\d+(\s+of\s+\d+)?$/i.test(line))
    .filter((line) => !/^(confidential|curriculum vitae|resume)\s*$/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    cleanedText: cleaned.slice(0, maxChars),
    metrics: {
      originalCharCount: original.length,
      cleanedCharCount: cleaned.length,
      finalPromptCharCount: Math.min(cleaned.length, maxChars),
    },
  }
}

export function buildPromptWithJobDescription(systemPrompt, jobDescriptionContext = null) {
  const basePrompt = normalizePrompt(systemPrompt)
  const jdContext = jobDescriptionContext && typeof jobDescriptionContext === 'object'
    ? jobDescriptionContext
    : null

  const hasJobDescription = Boolean(jdContext?.hasContext)
  const jdSummary = hasJobDescription
    ? [
        `- Job Description ID: ${formatScalar(jdContext?.jobDescriptionId) || 'unknown'}`,
        `- Title: ${formatScalar(jdContext?.title) || 'Not provided'}`,
        `- Description: ${formatScalar(jdContext?.description) || 'Not provided'}`,
        `- Requirements: ${formatScalar(jdContext?.requirements) || 'Not provided'}`,
        `- Skills: ${formatArray(jdContext?.skills) || 'Not provided'}`,
        `- Experience Years: ${formatScalar(jdContext?.experienceYears) || 'Not provided'}`,
        `- Location: ${formatScalar(jdContext?.location) || 'Not provided'}`,
        `- Source: ${formatScalar(jdContext?.source) || 'manual_fields'}`,
      ].join('\n')
    : `- Missing reason: ${formatScalar(jdContext?.missingReason) || 'job_description_missing'}`

  const analysisModeDirectives = buildAnalysisModeDirectives(jdContext)

  return `${basePrompt}\n\n${analysisModeDirectives}\n\nResume-to-Job matching directives:\n1) If Job Description context is available below, evaluate candidate-job fit and include JD-aware scoring/rationale in your JSON fields where relevant.\n2) If Job Description context is missing, continue normal resume parsing and include an explicit reason marker "job_description_missing" in candidate rationale/notes fields when present.\n\nJob Description Context:\n${hasJobDescription ? 'AVAILABLE' : 'MISSING'}\n${jdSummary}`
}


function buildPromptMetrics({ prompt, systemPrompt, outputInstruction, jobDescriptionContext, resumeCharCount = null, inputMode = 'document_file' }) {
  return {
    promptCharCount: String(prompt || '').length,
    systemPromptCharCount: String(systemPrompt || '').length,
    outputInstructionCharCount: String(outputInstruction || '').length,
    jdContextCharCount: String(jobDescriptionContext?.description || '').length + String(jobDescriptionContext?.requirements || '').length,
    resumeTextCharCount: Number.isFinite(resumeCharCount) ? resumeCharCount : null,
    inputMode,
  }
}

export async function analyzeWithAnthropic(
  fileBufferBase64,
  mimeType,
  filename,
  {
    apiKey,
    model = MODEL,
    keyLabel = 'primary',
    providerSource = 'unknown',
    systemPromptConfig = null,
    jobDescriptionContext = null,
    anthropicClientFactory = null,
    compactMode = false,
    promptTextOverride = null,
    diagnosticsContext = {},
  } = {},
) {
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Claude analysis unavailable.')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'
  const isPlainTextInput = mimeType === 'text/plain'
  const resumeText = isPlainTextInput ? Buffer.from(fileBufferBase64, 'base64').toString('utf8') : null
  const client = anthropicClientFactory
    ? anthropicClientFactory({ apiKey })
    : new Anthropic({ apiKey })

  const baseOutputInstructions = buildCompactOutputInstructions({ compactMode })
  const systemPromptText = promptTextOverride || buildPromptWithJobDescription(systemPromptConfig?.systemPrompt, jobDescriptionContext)
  const prompt = `${systemPromptText}\n\n${baseOutputInstructions}`
  const promptVersion = systemPromptConfig?.promptVersion || 1
  const parseContext = {
    analysisId: diagnosticsContext?.analysisId || null,
    resumeId: diagnosticsContext?.resumeId || null,
    parseJobId: diagnosticsContext?.parseJobId || null,
    originalFilenameFingerprint: diagnosticsContext?.originalFilenameFingerprint || null,
    fileExtension: diagnosticsContext?.fileExtension || null,
    extractionMethod: diagnosticsContext?.extractionMethod || null,
    inputKind: diagnosticsContext?.inputKind || null,
    promptCharCount: prompt.length,
  }
  const promptIsDefaultFallback = Boolean(systemPromptConfig?.isDefaultFallback)
  const promptMetrics = buildPromptMetrics({
    prompt,
    systemPrompt: systemPromptText,
    outputInstruction: baseOutputInstructions,
    jobDescriptionContext,
    resumeCharCount: isPlainTextInput ? String(resumeText || '').length : null,
    inputMode: isPlainTextInput ? 'text_content' : 'document_file',
  })
  console.log('[AI Parse] Prompt metrics:', { provider: 'anthropic', model, ...promptMetrics })
  console.log(
    '[HireFlow] JD in AI user message:',
    prompt.includes('Job Description Context:\nAVAILABLE') ? 'YES' : 'NO — JD missing from prompt',
  )

  const tokenConfig = TOKEN_BUDGET_CONFIG.anthropic
  const ladderProfile = keyLabel === 'primary' ? 'primary' : 'escalation'
  const ladderMode = compactMode ? 'compact' : 'standard'
  const tokenLadder = buildTokenBudgetLadder(tokenConfig?.[ladderProfile]?.[ladderMode], tokenConfig?.providerMaxOutputTokens)
  let attemptedTokenBudgets = []
  let response = null
  let result = null

  for (let index = 0; index < tokenLadder.length; index += 1) {
    const maxTokens = tokenLadder[index]
    const truncationSafeMode = index > 0
    const bareMinimumMode = index > 1
    const outputInstructions = truncationSafeMode
      ? buildCompactOutputInstructions({ compactMode: true, truncationSafeMode: true, bareMinimumMode })
      : baseOutputInstructions
    const requestPrompt = `${systemPromptText}

${outputInstructions}`
    attemptedTokenBudgets.push({ maxTokens, mode: bareMinimumMode ? 'bare_minimum' : (truncationSafeMode ? 'truncation_safe' : (compactMode ? 'minimal' : 'compact')) })

    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: isPlainTextInput
            ? [
                {
                  type: 'text',
                  text: `${resumeText}

${requestPrompt}`,
                },
              ]
            : [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: fileBufferBase64,
                  },
                },
                {
                  type: 'text',
                  text: requestPrompt,
                },
              ],
        },
      ],
    })

    const tokenUsage = normalizeUsageMetrics(response?.usage, 'anthropic')
    if (tokenUsage.usageAvailable) {
      await trackTokens(response.usage, filename)
    }

    const textContent = (response.content || []).find((item) => item.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw createProviderResponseFormatError({
        provider: 'anthropic',
        model,
        technicalDetails: `Unexpected Anthropic response format (${buildPayloadKeySummary(response)})`,
      })
    }

    try {
      logRawAiResponseForLocalDebug('[AI][Anthropic] Raw response before parsing', textContent.text)
      result = extractJsonWithContext(textContent.text, { provider: 'anthropic', model, promptVersion, maxOutputTokens: maxTokens, completionStatus: response?.stop_reason || null, stopReason: response?.stop_reason || null, retryMetadata: { token_budget_attempt_index: index + 1, token_budget_attempt_count: tokenLadder.length }, attemptIndex: index + 1, maxAttempts: tokenLadder.length, ...parseContext })
      break
    } catch (error) {
      const parseFailed = String(error?.message || '').includes('response_format_error::')
      if (!parseFailed) throw error
      const truncated = isLikelyTruncatedResponse(textContent.text, { stopReason: response?.stop_reason })
      if (truncated && index < tokenLadder.length - 1) {
        continue
      }
      if (truncated) {
        const truncationError = createProviderResponseFormatError({
          category: 'response_truncated_error',
          provider: 'anthropic',
          model,
          technicalDetails: `Provider output was truncated before valid JSON completion after retries (stop_reason=${sanitizeSnippet(response?.stop_reason || 'unknown')}, max_tokens_attempted=${tokenLadder.join('->')}).`,
        })
        truncationError.tokenBudgetAttempts = attemptedTokenBudgets
        throw truncationError
      }
      error.tokenBudgetAttempts = attemptedTokenBudgets
      throw error
    }
  }

  if (!result) {
    const truncationError = createProviderResponseFormatError({
      category: 'response_truncated_error',
      provider: 'anthropic',
      model,
      technicalDetails: `Provider output was truncated before valid JSON completion after retries (max_tokens_attempted=${tokenLadder.join('->')}).`,
    })
    truncationError.tokenBudgetAttempts = attemptedTokenBudgets
    throw truncationError
  }

  const tokenUsage = normalizeUsageMetrics(response?.usage, 'anthropic')
  result = normalizeCompactAnalysis(result, {
    minimalMode: compactMode,
    aiScoringContractV2Expected: false,
  })
  if (!Array.isArray(result?.candidates)) {
    throw new Error('Anthropic response is missing candidates array')
  }

  return {
    result,
    tokenUsage,
    provider: `anthropic-${keyLabel}`,
    model,
    credentialLabel: keyLabel,
    providerSource,
    promptVersion,
    promptIsDefaultFallback,
    mode: compactMode ? 'minimal' : 'compact',
    schemaVersion: CANDIDATE_COMPACT_SCHEMA_VERSION,
    maxOutputTokens: attemptedTokenBudgets[attemptedTokenBudgets.length - 1]?.maxTokens || null,
    tokenBudgetAttempts: attemptedTokenBudgets,
    promptCharCount: promptMetrics.promptCharCount,
    resumeCharCount: null,
    jdCharCount: String(jobDescriptionContext?.description || '').length + String(jobDescriptionContext?.requirements || '').length,
  }
}

export async function analyzeWithOpenAI(
  fileBufferBase64,
  mimeType,
  _filename,
  {
    apiKey,
    model = 'gpt-4o-mini',
    keyLabel = 'primary',
    providerSource = 'unknown',
    systemPromptConfig = null,
    jobDescriptionContext = null,
    modelCapabilities = null,
    fetchImpl = fetch,
    compactMode = false,
    promptTextOverride = null,
    diagnosticsContext = {},
  } = {},
) {
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. OpenAI analysis unavailable.')
  }

  const mediaType = MIME_TYPE_MAP[mimeType] || 'application/octet-stream'
  const isPlainTextInput = mimeType === 'text/plain'
  const resumeText = isPlainTextInput ? Buffer.from(fileBufferBase64, 'base64').toString('utf8') : null
  const baseOutputInstructions = buildCompactOutputInstructions({ compactMode })
  const systemPromptText = promptTextOverride || buildPromptWithJobDescription(systemPromptConfig?.systemPrompt, jobDescriptionContext)
  const prompt = `${systemPromptText}\n\n${baseOutputInstructions}`
  const promptVersion = systemPromptConfig?.promptVersion || 1
  const promptIsDefaultFallback = Boolean(systemPromptConfig?.isDefaultFallback)
  const promptMetrics = buildPromptMetrics({
    prompt,
    systemPrompt: systemPromptText,
    outputInstruction: baseOutputInstructions,
    jobDescriptionContext,
    resumeCharCount: isPlainTextInput ? String(resumeText || '').length : null,
    inputMode: isPlainTextInput ? 'text_content' : 'document_file',
  })
  console.log('[AI Parse] Prompt metrics:', { provider: 'openai', model, ...promptMetrics })
  console.log(
    '[HireFlow] JD in AI user message:',
    prompt.includes('Job Description Context:\nAVAILABLE') ? 'YES' : 'NO — JD missing from prompt',
  )

  const effectiveModelCapabilities = modelCapabilities && typeof modelCapabilities === 'object'
    ? modelCapabilities
    : OPENAI_MODEL_CAPABILITIES.default

  const buildRequestBody = (maxOutputTokens, promptText) => {
    const requestBody = {
      model,
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: 'user',
          content: isPlainTextInput
            ? [
                {
                  type: 'input_text',
                  text: `${resumeText}

${promptText}`,
                },
              ]
            : [
                {
                  type: 'input_file',
                  filename: 'resume',
                  file_data: `data:${mediaType};base64,${fileBufferBase64}`,
                },
                {
                  type: 'input_text',
                  text: promptText,
                },
              ],
        },
      ],
    }

    if (effectiveModelCapabilities.supportsTemperature === true) {
      requestBody.temperature = 0
    }
    return requestBody
  }

  const callOpenAi = async (maxOutputTokens, promptText) => {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(maxOutputTokens, promptText)),
    })

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      const message = errorPayload?.error?.message || `OpenAI request failed with status ${response.status}`
      throw new Error(message)
    }

    const payload = await response.json()
    if (payload?.error?.message) {
      throw new Error(String(payload.error.message))
    }

    return payload
  }

  let payload = null
  let responseStatus = ''
  let incompleteReason = ''
  const tokenConfig = TOKEN_BUDGET_CONFIG.openai
  const tokenLadder = buildTokenBudgetLadder(tokenConfig?.fallback?.[compactMode ? 'compact' : 'standard'], tokenConfig?.providerMaxOutputTokens)
  let attemptedMaxOutputTokens = tokenLadder[0]
  const attemptedTokenBudgets = []
  for (let index = 0; index < tokenLadder.length; index += 1) {
    const maxOutputTokens = tokenLadder[index]
    const retryingAfterTokenCeiling = index > 0
    const bareMinimumMode = index > 1
    const retryOutputInstructions = retryingAfterTokenCeiling
      ? buildCompactOutputInstructions({ compactMode: true, truncationSafeMode: true, bareMinimumMode })
      : baseOutputInstructions
    const requestPrompt = `${systemPromptText}\n\n${retryOutputInstructions}`

    attemptedMaxOutputTokens = maxOutputTokens
    attemptedTokenBudgets.push({ maxTokens: maxOutputTokens, mode: bareMinimumMode ? 'bare_minimum' : (retryingAfterTokenCeiling ? 'truncation_safe' : (compactMode ? 'minimal' : 'compact')) })
    payload = await callOpenAi(maxOutputTokens, requestPrompt)
    responseStatus = String(payload?.status || '').toLowerCase()
    incompleteReason = String(payload?.incomplete_details?.reason || '').trim()

    const shouldRetryForTokenCeiling = responseStatus === 'incomplete' && incompleteReason.toLowerCase() === 'max_output_tokens'
    if (shouldRetryForTokenCeiling) {
      continue
    }

    break
  }

  if (responseStatus && responseStatus !== 'completed') {
    if (incompleteReason.toLowerCase() === 'max_output_tokens') {
      const truncationError = createProviderResponseFormatError({
        category: 'response_truncated_error',
        provider: 'openai',
        model,
        technicalDetails: `Provider output was truncated before valid JSON completion after retries (status=${sanitizeSnippet(responseStatus)}, reason=${sanitizeSnippet(incompleteReason)}, max_output_tokens_attempted=${tokenLadder.join('->')}).`,
      })
      truncationError.tokenBudgetAttempts = attemptedTokenBudgets
      throw truncationError
    }

    throw new Error(`OpenAI response status was ${responseStatus}${incompleteReason ? ` (${incompleteReason})` : ''}`)
  }

  const outputText = extractOpenAiResponseText(payload)
  if (!outputText) {
    throw createProviderResponseFormatError({
      provider: 'openai',
      model,
      technicalDetails: `Unexpected OpenAI response format (${buildPayloadKeySummary(payload)})`,
    })
  }

  logRawAiResponseForLocalDebug('[AI][OpenAI] Raw response before parsing', outputText)
  const result = normalizeCompactAnalysis(
    extractJsonWithContext(outputText, { provider: 'openai', model, promptVersion, maxOutputTokens: attemptedMaxOutputTokens, completionStatus: responseStatus || 'completed', stopReason: incompleteReason || null, retryMetadata: { token_budget_attempt_count: attemptedTokenBudgets.length }, ...diagnosticsContext }),
    {
      minimalMode: compactMode,
      aiScoringContractV2Expected: false,
    },
  )
  if (!Array.isArray(result?.candidates)) {
    throw new Error('OpenAI response is missing candidates array')
  }

  return {
    result,
    tokenUsage: normalizeUsageMetrics(payload?.usage, 'openai'),
    provider: `openai-${keyLabel}`,
    model,
    credentialLabel: keyLabel,
    providerSource,
    promptVersion,
    promptIsDefaultFallback,
    mode: compactMode ? 'minimal' : 'compact',
    schemaVersion: CANDIDATE_COMPACT_SCHEMA_VERSION,
    maxOutputTokens: attemptedMaxOutputTokens,
    tokenBudgetAttempts: attemptedTokenBudgets,
    promptCharCount: promptMetrics.promptCharCount,
    resumeCharCount: null,
    jdCharCount: String(jobDescriptionContext?.description || '').length + String(jobDescriptionContext?.requirements || '').length,
  }
}


function getAiScoringContractV2ShadowTimeoutMs(env = process.env) {
  const parsed = Number.parseInt(String(env.AI_SCORING_CONTRACT_V2_SHADOW_TIMEOUT_MS || '15000'), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000
}

function buildAiScoringContractV2SeparateShadowPrompt({ resumeText, jobDescriptionContext }) {
  const jd = jobDescriptionContext && typeof jobDescriptionContext === 'object' ? jobDescriptionContext : {}
  return [
    'AI Scoring Contract v2 separate shadow-only analysis.',
    'Return ONLY valid JSON. Do not return candidate analysis, names, emails, phone numbers, explanations outside the JSON, or markdown.',
    'Score the resume against the Job Description on a 0-100 scale using these weights: skills_match_score 40%, relevant_experience_score 30%, education_relevance_score 15%, seniority_progression_score 15%.',
    'Compute weighted_total_score = skills_match_score*0.40 + relevant_experience_score*0.30 + education_relevance_score*0.15 + seniority_progression_score*0.15.',
    'Use 0-100 values only; do not use 0-10 values.',
    'Experience-floor calibration: relevant_experience_score must strongly reflect the required minimum years in the JD. If the resume shows fewer years than the JD minimum, relevant_experience_score should usually be capped in the 25-45 range depending on evidence, and seniority_progression_score should remain junior-level rather than mid/senior.',
    'Education relevance must not overcompensate for an experience gap. Skills match alone must not lift weighted_total_score into moderate/strong fit when the candidate fails the JD minimum experience requirement.',
    'JSON schema: {"scoring_contract_version":"ai_jd_fit_rubric_v2","skills_match_score":number,"relevant_experience_score":number,"education_relevance_score":number,"seniority_progression_score":number,"weighted_total_score":number,"score_confidence":"high|medium|low","score_confidence_reason":"string","scoring_anomalies":["safe_internal_codes_only"],"has_job_description_context":true}',
    '',
    'Job Description Context:',
    `Title: ${formatScalar(jd.title) || 'Not provided'}`,
    `Description: ${formatScalar(jd.description) || 'Not provided'}`,
    `Requirements: ${formatScalar(jd.requirements) || 'Not provided'}`,
    `Skills: ${formatArray(jd.skills) || 'Not provided'}`,
    `Experience Years: ${formatScalar(jd.experienceYears) || 'Not provided'}`,
    '',
    'Resume Text:',
    String(resumeText || '').slice(0, DEFAULT_RESUME_TEXT_PROMPT_CHAR_LIMIT),
  ].join('\n')
}

function withAiScoringContractV2Timeout(promise, timeoutMs) {
  let timeoutHandle
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('v2_shadow_timeout')), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle))
}

function normalizeAiScoringContractV2ShadowPayload(payload, options = {}) {
  const contract = payload?.ai_scoring_contract_v2 && typeof payload.ai_scoring_contract_v2 === 'object'
    ? payload.ai_scoring_contract_v2
    : payload
  return normalizeAiScoringContractV2(contract, options)
}

function buildSkippedAiScoringContractV2ShadowDiagnostic(reason) {
  return buildMissingAiScoringContractV2Diagnostic({
    reason,
    scoreConfidenceReason: 'v2 shadow skipped because extracted text was unavailable',
  })
}

function logSafeAiScoringContractV2ShadowDiagnostic(logger, message, metadata = {}) {
  const safeMetadata = {
    action: metadata.action || 'v2_shadow',
    analysis_id: metadata.analysisId || null,
    resume_id: metadata.resumeId || null,
    user_id: metadata.userId ?? null,
    provider: metadata.provider || null,
    model: metadata.model || null,
    error_code: metadata.errorCode || null,
  }
  ;(logger?.warn || console.warn).call(logger || console, message, safeMetadata)
}

export async function runAiScoringContractV2ShadowAnalysis({
  resumeText = '',
  jobDescriptionContext = null,
  userId = null,
  analysisId = null,
  resumeId = null,
  candidates = [],
  credentials = null,
  providerCall = null,
  env = process.env,
  logger = console,
  inputDiagnostics = null,
} = {}) {
  if (!isAiScoringContractV2ShadowEnabled({ userId, analysisId }, env)) return { attempted: false, reason: 'disabled_or_not_allowlisted' }
  if (!jobDescriptionContext?.hasContext) return { attempted: false, reason: 'missing_jd_context' }
  if (!Array.isArray(candidates) || candidates.length === 0) return { attempted: false, reason: 'missing_candidates' }
  if (!String(resumeText || '').trim()) {
    const inputKind = String(inputDiagnostics?.inputKind || '').trim().toLowerCase()
    const inputMode = String(inputDiagnostics?.inputMode || '').trim().toLowerCase()
    const normalizedTextCharCount = Number(inputDiagnostics?.normalizedTextCharCount || 0)
    const reason = (inputKind === 'pdf_binary' || inputMode === 'binary') && normalizedTextCharCount === 0
      ? 'v2_shadow_skipped_binary_input_without_text'
      : 'v2_shadow_missing_resume_text'
    logSafeAiScoringContractV2ShadowDiagnostic(logger, '[AI Parse] AI scoring contract v2 shadow skipped.', {
      userId, analysisId, resumeId, errorCode: reason,
    })
    return { attempted: true, skipped: true, reason, contract: buildSkippedAiScoringContractV2ShadowDiagnostic(reason) }
  }

  const timeoutMs = getAiScoringContractV2ShadowTimeoutMs(env)
  const prompt = buildAiScoringContractV2SeparateShadowPrompt({ resumeText, jobDescriptionContext })

  try {
    const call = providerCall || (async (promptText) => {
      const activeCredentials = credentials || await getActiveAiProviderCredentials()
      const entry = buildProviderAttemptPlan(activeCredentials)[0]
      if (!entry) throw new Error('v2_shadow_no_provider')
      if (entry.provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${entry.apiKey}` },
          body: JSON.stringify({ model: entry.model || 'gpt-4o-mini', max_output_tokens: 800, input: [{ role: 'user', content: [{ type: 'input_text', text: promptText }] }] }),
        })
        if (!response.ok) throw new Error(`v2_shadow_openai_status_${response.status}`)
        const payload = await response.json()
        return { text: extractOpenAiResponseText(payload), provider: 'openai', model: entry.model || null }
      }
      const client = new Anthropic({ apiKey: entry.apiKey })
      const response = await client.messages.create({ model: entry.model || MODEL, max_tokens: 800, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: promptText }] }] })
      const text = (response.content || []).find((item) => item.type === 'text')?.text || ''
      return { text, provider: 'anthropic', model: entry.model || MODEL }
    })

    const response = await withAiScoringContractV2Timeout(call(prompt), timeoutMs)
    const rawPayload = typeof response?.text === 'string'
      ? extractJsonWithContext(response.text, { provider: response.provider || null, model: response.model || null })
      : response
    const normalized = normalizeAiScoringContractV2ShadowPayload(rawPayload, {
      hasJobDescriptionContext: true,
      jobDescriptionContext,
      candidate: candidates[0] || null,
    })
    if (!normalized) throw new Error('v2_missing_contract')
    return { attempted: true, contract: normalized, provider: response?.provider || null, model: response?.model || null }
  } catch (error) {
    logSafeAiScoringContractV2ShadowDiagnostic(logger, '[AI Parse] AI scoring contract v2 shadow failed open.', {
      userId, analysisId, resumeId, errorCode: String(error?.message || 'v2_shadow_failed').slice(0, 80),
    })
    return { attempted: true, contract: null, errorCode: 'v2_shadow_failed' }
  }
}

export async function analyzeResumeWithConfiguredFallback(fileBufferBase64, mimeType, filename, options = {}) {
  const credentials = options.credentials || await getActiveAiProviderCredentials()
  const systemPromptConfig = options.systemPromptConfig || await getRuntimeSystemPromptConfig()
  const governance = credentials?.governance && typeof credentials.governance === 'object'
    ? credentials.governance
    : { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } }
  if (governance.aiEnabled === false || governance?.workflowToggles?.resumeAnalysisEnabled === false) {
    throw new Error('ai_disabled_error::AI resume analysis is disabled by admin governance policy.')
  }
  const adapters = {
    anthropic: options.analyzeWithAnthropic || analyzeWithAnthropic,
    openai: options.analyzeWithOpenAI || analyzeWithOpenAI,
  }
  const attemptPlan = buildProviderAttemptPlan(credentials)

  if (attemptPlan.length === 0) {
    throw new Error('No configured AI API keys found. Configure provider primary/fallback keys in Admin Security.')
  }

  let lastError = null
  const attemptHistory = []
  const compactByDefaultForEntry = (entry) => {
    if (String(entry?.provider || '').toLowerCase() !== 'openai') return false
    const providerSettings = credentials?.providers?.openai
    if (!providerSettings || typeof providerSettings !== 'object') return false

    const configuredModels = ['primary', 'fallback']
      .map((label) => String(providerSettings?.[label]?.model || '').trim())
      .filter(Boolean)

    if (!configuredModels.length) return false
    return configuredModels.includes(String(entry?.model || '').trim())
  }
  const preparedPayload = await prepareResumePayloadForAnalysis({
    fileBufferBase64,
    mimeType,
    filename,
    diagnosticsContext: options?.diagnosticsContext || {},
  })
  const preparedMimeType = preparedPayload.preparedMimeType || preparedPayload.mimeType
  const inputKind = preparedPayload.inputKind || (String(preparedMimeType).toLowerCase() === 'text/plain' ? 'extracted_text' : 'pdf_binary')
  const inputDiagnostics = preparedPayload.diagnostics && typeof preparedPayload.diagnostics === 'object'
    ? preparedPayload.diagnostics
    : null
  const isTextPayload = String(preparedMimeType || '').toLowerCase() === 'text/plain'
  const rawExtractedText = preparedPayload.extractedText || (isTextPayload ? Buffer.from(String(preparedPayload.fileBufferBase64 || ''), 'base64').toString('utf8') : '')
  const cleanedPayload = isTextPayload ? cleanExtractedTextForPrompt(rawExtractedText, { maxChars: DEFAULT_RESUME_TEXT_PROMPT_CHAR_LIMIT }) : null
  const cleanedBase64 = cleanedPayload ? Buffer.from(cleanedPayload.cleanedText, 'utf8').toString('base64') : preparedPayload.fileBufferBase64
  const jdCharCount = String(options?.jobDescriptionContext?.description || '').length + String(options?.jobDescriptionContext?.requirements || '').length
  const complexityEstimator = estimateAnalysisComplexity({
    mimeType: preparedMimeType,
    cleanedResumeCharCount: cleanedPayload?.metrics?.cleanedCharCount || cleanedPayload?.cleanedText?.length || 0,
    jdCharCount,
    inputMode: cleanedPayload ? 'text' : 'binary',
  })
  console.log('[AI Parse] Complexity estimator output:', complexityEstimator)
  console.log('[AI Parse] Prepared resume input:', {
    originalMimeType: preparedPayload.originalMimeType || mimeType,
    preparedMimeType,
    sourceFormat: preparedPayload.sourceFormat || 'unknown',
    inputKind,
    promptInputMode: cleanedPayload ? 'text_content' : 'document_file',
    extractionMethod: inputDiagnostics?.extractionMethod || null,
    extractedTextCharCount: inputDiagnostics?.extractedTextCharCount || 0,
    normalizedTextCharCount: inputDiagnostics?.normalizedTextCharCount || 0,
    normalizedTextFingerprint: inputDiagnostics?.normalizedTextFingerprint || null,
    providerPlan: attemptPlan.map((entry) => `${entry.provider}:${entry.keyLabel}`),
    compactModeDecision: complexityEstimator.recommendedMode,
    jobDescriptionContextUsed: Boolean(options?.jobDescriptionContext?.hasContext),
    jobDescriptionContextSource: options?.jobDescriptionContext?.source || 'none',
  })

  const selectableAttempts = []
  for (const entry of attemptPlan) {
    if (!providerSupportsMimeType(entry.provider, preparedMimeType, inputKind, cleanedPayload?.cleanedText || rawExtractedText)) {
      console.log(`[AI Parse] Skipping ${entry.provider}:${entry.keyLabel}.`, {
        reason: 'provider_input_incompatible',
        provider: entry.provider,
        keyLabel: entry.keyLabel,
        preparedMimeType,
        inputKind,
        extractionMethod: inputDiagnostics?.extractionMethod || null,
        extractedTextCharCount: inputDiagnostics?.extractedTextCharCount || 0,
      })
      continue
    }
    selectableAttempts.push(entry)
  }

  const maxAttemptsPerFile = getMaxProviderAttemptsPerFile()
  const primaryEntry = selectableAttempts[0] || null
  const fallbackEntries = selectableAttempts.slice(1)
  const deterministicPlan = [
    primaryEntry,
    ...fallbackEntries,
    primaryEntry,
  ].filter(Boolean).slice(0, maxAttemptsPerFile)
  const finalPrimaryPlanIndex = deterministicPlan.length - 1

  for (let planIndex = 0; planIndex < deterministicPlan.length; planIndex += 1) {
    const entry = deterministicPlan[planIndex]
    const isFinalPrimaryRetry = planIndex === finalPrimaryPlanIndex
      && primaryEntry
      && entry.provider === primaryEntry.provider
      && entry.keyLabel === primaryEntry.keyLabel
      && planIndex > 0
    const role = isFinalPrimaryRetry || planIndex === 0 ? 'primary' : 'fallback'

    if (isFinalPrimaryRetry) {
      const firstFailure = attemptHistory[0]
      const fallbackFailure = attemptHistory[planIndex - 1]
      if (!firstFailure || !fallbackFailure || firstFailure.success !== false || fallbackFailure.success !== false) {
        break
      }
      if ((firstFailure.normalizedReason || '') === (fallbackFailure.normalizedReason || '')) {
        console.warn('[AI Parse] Skipping final primary retry because fallback failed with same normalized reason.')
        break
      }
    }

    let compactMode = complexityEstimator.recommendedMode === 'COMPACT_MINIMAL'
      ? true
      : compactByDefaultForEntry(entry)
    try {
      const adapter = adapters[entry.provider] || analyzeWithAnthropic
      const response = await adapter(cleanedBase64, preparedMimeType, filename, {
        apiKey: entry.apiKey,
        model: entry.model,
        keyLabel: entry.keyLabel,
        providerSource: entry.source,
        systemPromptConfig,
        jobDescriptionContext: options.jobDescriptionContext || null,
        compactMode,
        promptTextOverride: null,
        diagnosticsContext: {
          ...(options?.diagnosticsContext || {}),
          extractionMethod: inputDiagnostics?.extractionMethod || options?.diagnosticsContext?.extractionMethod || null,
          inputKind,
        },
      })
      if (cleanedPayload?.metrics) {
        console.log('[AI Parse] Prompt payload metrics:', {
          provider: entry.provider,
          model: entry.model,
          ...cleanedPayload.metrics,
        })
      }

      return {
        ...response,
        shadowInput: { resumeText: cleanedPayload?.cleanedText || rawExtractedText || '' },
        attempts: [
          ...attemptHistory,
          createAttemptRecord({
            success: true,
            provider: entry.provider,
            keyLabel: entry.keyLabel,
            model: response.model,
            role,
            attemptNumber: planIndex + 1,
            providerSource: entry.source,
            promptVersion: response.promptVersion,
            promptIsDefaultFallback: response.promptIsDefaultFallback,
            tokenUsage: response.tokenUsage,
            tokenBudgetAttempts: response.tokenBudgetAttempts,
            complexityEstimator,
            inputDiagnostics,
          }),
        ],
      }
    } catch (error) {
      let normalizedMessage = normalizeProviderError(error, attemptHistory)
      let failureCategory = getFailureCategory(normalizedMessage)
      let statusCode = extractStatusCodeFromError(error)
      const retryBackoffMs = [1000, 2000]
      const overloadFailure = isOverloadFailure({ failureCategory, normalizedMessage, statusCode })

      if (false && overloadFailure) {
        let retryError = error
        let overloadRecovered = false
        for (let retryIndex = 0; retryIndex < retryBackoffMs.length; retryIndex += 1) {
          await sleep(retryBackoffMs[retryIndex])
          try {
            const adapter = adapters[entry.provider] || analyzeWithAnthropic
            const retryResponse = await adapter(cleanedBase64, mimeType, filename, {
              apiKey: entry.apiKey,
              model: entry.model,
              keyLabel: entry.keyLabel,
              providerSource: entry.source,
              systemPromptConfig,
              jobDescriptionContext: options.jobDescriptionContext || null,
              compactMode,
              promptTextOverride: null,
            })
            overloadRecovered = true
            return {
              ...retryResponse,
              attempts: [
                ...attemptHistory,
                createAttemptRecord({
                  success: true,
                  provider: entry.provider,
                  keyLabel: entry.keyLabel,
                  model: retryResponse.model,
                  providerSource: entry.source,
                  promptVersion: retryResponse.promptVersion,
                  promptIsDefaultFallback: retryResponse.promptIsDefaultFallback,
                  tokenUsage: retryResponse.tokenUsage,
                  mode: compactMode ? 'minimal' : 'compact',
                  retryPolicy: `overload_backoff_${retryBackoffMs.join('->')}ms`,
                  retryReason: 'overload_retried_same_provider_model_key',
                  statusCode,
                  complexityEstimator,
                }),
              ],
            }
          } catch (retryAttemptError) {
            retryError = retryAttemptError
          }
        }
        if (!overloadRecovered) {
          error = retryError
          normalizedMessage = normalizeProviderError(error, attemptHistory)
          failureCategory = getFailureCategory(normalizedMessage)
          statusCode = extractStatusCodeFromError(error)
        }
      }

      const firstFailureCategory = failureCategory
      if (false && firstFailureCategory === 'response_truncated_error' && compactMode === true) {
        try {
          const adapter = adapters[entry.provider] || analyzeWithAnthropic
          const response = await adapter(cleanedBase64, mimeType, filename, {
            apiKey: entry.apiKey,
            model: entry.model,
            keyLabel: entry.keyLabel,
            providerSource: entry.source,
            systemPromptConfig,
            jobDescriptionContext: options.jobDescriptionContext || null,
            compactMode: false,
          })
          return {
            ...response,
            attempts: [
              ...attemptHistory,
              createAttemptRecord({ success: false, provider: entry.provider, keyLabel: entry.keyLabel, model: entry.model, providerSource: entry.source, promptVersion: systemPromptConfig?.promptVersion || 1, promptIsDefaultFallback: Boolean(systemPromptConfig?.isDefaultFallback), tokenUsage: { usageAvailable: false, unavailableReason: 'provider_request_failed:response_truncated_error:compact_pass' }, failureCategory: 'response_truncated_error', failureReason: 'compact attempt truncated; bare minimum retry succeeded', mode: 'minimal', complexityEstimator }),
              createAttemptRecord({ success: true, provider: entry.provider, keyLabel: entry.keyLabel, model: response.model, providerSource: entry.source, promptVersion: response.promptVersion, promptIsDefaultFallback: response.promptIsDefaultFallback, tokenUsage: response.tokenUsage, tokenBudgetAttempts: response.tokenBudgetAttempts, mode: response.mode || 'bare_minimum', complexityEstimator }),
            ],
          }
        } catch (bareMinimumRetryError) {
          error = bareMinimumRetryError
          normalizedMessage = normalizeProviderError(error, attemptHistory)
          failureCategory = getFailureCategory(normalizedMessage)
          statusCode = extractStatusCodeFromError(error)
        }
      }
      if (false && entry.provider === 'anthropic' && firstFailureCategory === 'response_truncated_error' && compactMode === false) {
        try {
          const adapter = adapters[entry.provider] || analyzeWithAnthropic
          const response = await adapter(cleanedBase64, mimeType, filename, {
            apiKey: entry.apiKey,
            model: entry.model,
            keyLabel: entry.keyLabel,
            providerSource: entry.source,
            systemPromptConfig,
            jobDescriptionContext: options.jobDescriptionContext || null,
            compactMode: true,
          })
          return {
            ...response,
            attempts: [
              ...attemptHistory,
              createAttemptRecord({ success: false, provider: entry.provider, keyLabel: entry.keyLabel, model: entry.model, providerSource: entry.source, promptVersion: systemPromptConfig?.promptVersion || 1, promptIsDefaultFallback: Boolean(systemPromptConfig?.isDefaultFallback), tokenUsage: { usageAvailable: false, unavailableReason: 'provider_request_failed:response_truncated_error:first_pass' }, failureCategory: 'response_truncated_error', failureReason: 'first attempt truncated; compact retry succeeded', complexityEstimator }),
              createAttemptRecord({ success: true, provider: entry.provider, keyLabel: entry.keyLabel, model: response.model, providerSource: entry.source, promptVersion: response.promptVersion, promptIsDefaultFallback: response.promptIsDefaultFallback, tokenUsage: response.tokenUsage, tokenBudgetAttempts: response.tokenBudgetAttempts, complexityEstimator }),
            ],
          }
        } catch (compactRetryError) {
          error = compactRetryError
        }
      }
      lastError = error
      const failureReason = sanitizeSnippet(String(error?.message || 'unknown_error'), 220)
      const normalizedReason = normalizeFailureReasonForRetry(error)
      attemptHistory.push(createAttemptRecord({
        success: false,
        provider: entry.provider,
        keyLabel: entry.keyLabel,
        model: entry.model,
        role,
        attemptNumber: planIndex + 1,
        normalizedReason,
        providerSource: entry.source,
        promptVersion: systemPromptConfig?.promptVersion || 1,
        promptIsDefaultFallback: Boolean(systemPromptConfig?.isDefaultFallback),
        tokenUsage: {
          usageAvailable: false,
          unavailableReason: `provider_request_failed:${failureCategory}:${failureReason}`,
        },
        mode: compactMode ? 'minimal' : 'compact',
        tokenBudgetAttempts: Array.isArray(error?.tokenBudgetAttempts) ? error.tokenBudgetAttempts : [],
        failureCategory,
        failureReason,
        retryPolicy: overloadFailure ? `overload_backoff_${retryBackoffMs.join('->')}ms` : null,
        retryReason: overloadFailure ? 'overload_retries_exhausted' : null,
        statusCode,
        complexityEstimator,
        inputDiagnostics,
      }))
      if (failureCategory === 'response_truncated_error' && isFallbackDisabledOnTruncation()) {
        throw createTerminalProviderError(error, attemptHistory)
      }
      if (false && overloadFailure) {
        console.warn(`[AI Parse] ${entry.provider}:${entry.keyLabel} overloaded/capacity (${statusCode || 'unknown'}); retries exhausted, failing over.`, error.message)
      } else if (failureCategory === 'billing_quota_error') {
        console.warn(`[AI Parse] ${entry.provider}:${entry.keyLabel} quota/billing failed; immediate failover.`, error.message)
      } else if (failureCategory === 'response_format_error') {
        console.warn(`[AI Parse] ${entry.provider}:${entry.keyLabel} response format failed after repair retry; failing over.`, error.message)
      } else {
        console.warn(`[AI Parse] ${entry.provider}:${entry.keyLabel} failed:`, error.message)
      }

      if (planIndex === 0 && fallbackEntries.length === 0) break
    }
  }

  throw createTerminalProviderError(lastError, attemptHistory)
}

export const analyzeResumeWithClaude = analyzeWithAnthropic


export const __testables = { normalizeCompactCandidate, normalizeCompactAnalysis, normalizeAiScoringContractV2, isAiScoringContractV2ShadowEnabled, buildAiScoringContractV2SeparateShadowPrompt, getJobDescriptionMinimumExperienceYears, getCandidateExperienceYears, canonicalizeCandidateScoreFields, canonicalizeAnalysisScoreFields, isScoreFieldCanonicalizationEnabled }
