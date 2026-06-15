import { createHash } from 'node:crypto'

export const SCORE_CACHE_KEY_VERSION = 'score_cache_v1'
export const SCORE_CACHE_SCORING_CONTRACT_VERSION = 'canonical_score_fields_v1'
export const SCORE_CACHE_NO_JD_SENTINEL = 'no_jd_explicitly_allowed_v1'

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function hasUsableContent(value) {
  if (value === null || value === undefined) return false

  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true

  if (Array.isArray(value)) {
    return value.some((entry) => hasUsableContent(entry))
  }

  if (typeof value === 'object') {
    return Object.values(value).some((entry) => hasUsableContent(entry))
  }

  return false
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function sha256Stable(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function parseAllowlist(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isAllowedByList(value, rawAllowlist) {
  const allowlist = parseAllowlist(rawAllowlist)
  if (allowlist.length === 0) return true
  if (value === null || value === undefined || value === '') return false
  return allowlist.includes(String(value))
}

function normalizeCompactMode(compactMode) {
  return normalizeOptionalString(compactMode)
}

function resolveMatchScore(candidate = {}) {
  if (candidate?.matchScore && typeof candidate.matchScore === 'object' && !Array.isArray(candidate.matchScore)) {
    return normalizeOptionalNumber(candidate.matchScore.score)
  }

  const primitiveMatchScore = normalizeOptionalNumber(candidate?.matchScore)
  if (primitiveMatchScore !== null) return primitiveMatchScore

  return normalizeOptionalNumber(candidate?.score)
}

function normalizeSafeDiagnosticToken(value) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  if (/\.(pdf|docx?|txt)$/i.test(normalized)) return null
  return /^[a-z0-9_.:-]+$/i.test(normalized) ? normalized : null
}

export function isAiScoreCacheEnabled(env = process.env) {
  return String(env.AI_SCORE_CACHE_ENABLED || 'false').toLowerCase() === 'true'
}

export function buildScoreCacheResumeFingerprint({ extractedText, parsedResume, canonicalResumeFields } = {}) {
  const source = canonicalResumeFields ?? parsedResume ?? extractedText
  if (!hasUsableContent(source)) return null

  return sha256Stable({ type: 'resume', source })
}

export function buildScoreCacheJobDescriptionFingerprint({ jobDescription, allowNoJobDescription = false } = {}) {
  if (hasUsableContent(jobDescription)) {
    return sha256Stable({ type: 'job_description', jobDescription })
  }

  return allowNoJobDescription ? SCORE_CACHE_NO_JD_SENTINEL : null
}

export function buildScoreCacheKey({
  resumeFingerprint,
  jobDescriptionFingerprint,
  provider,
  model,
  promptVersion,
  compactMode,
  scoringContractVersion = SCORE_CACHE_SCORING_CONTRACT_VERSION,
  cacheKeyVersion = SCORE_CACHE_KEY_VERSION,
} = {}) {
  const required = {
    resumeFingerprint: normalizeOptionalString(resumeFingerprint),
    jobDescriptionFingerprint: normalizeOptionalString(jobDescriptionFingerprint),
    provider: normalizeOptionalString(provider),
    model: normalizeOptionalString(model),
    promptVersion: normalizeOptionalString(promptVersion),
    compactMode: normalizeCompactMode(compactMode),
    scoringContractVersion: normalizeOptionalString(scoringContractVersion),
    cacheKeyVersion: normalizeOptionalString(cacheKeyVersion),
  }

  const missingFields = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingFields.length > 0) {
    return { eligible: false, key: null, missingFields }
  }

  const material = {
    cache_key_version: required.cacheKeyVersion,
    scoring_contract_version: required.scoringContractVersion,
    resume_fingerprint: required.resumeFingerprint,
    job_description_fingerprint: required.jobDescriptionFingerprint,
    provider: required.provider,
    model: required.model,
    prompt_version: required.promptVersion,
    compact_mode: required.compactMode,
  }

  return {
    eligible: true,
    key: `${required.cacheKeyVersion}:${sha256Stable(material)}`,
    missingFields: [],
    material,
  }
}

export function buildScoreCacheValue(candidate = {}, metadata = {}) {
  const canonicalScore = resolveMatchScore(candidate)
  const canonicalScoreSource = normalizeSafeDiagnosticToken(
    candidate?.canonical_score_source ?? metadata.canonicalScoreSource ?? metadata.canonical_score_source,
  )
  const canonicalScoreContext = normalizeSafeDiagnosticToken(
    candidate?.canonical_score_context ?? metadata.canonicalScoreContext ?? metadata.canonical_score_context,
  )

  return {
    scoring_contract_version: normalizeOptionalString(metadata.scoringContractVersion) || SCORE_CACHE_SCORING_CONTRACT_VERSION,
    canonical_score: canonicalScore,
    score: canonicalScore,
    score_out_of_ten: canonicalScore === null ? null : roundToOneDecimal(canonicalScore / 10),
    canonical_score_source: canonicalScoreSource,
    canonical_score_context: canonicalScoreContext,
  }
}

export function buildScoreCacheEligibilityDiagnostic(metadata = {}, env = process.env) {
  const keyResult = buildScoreCacheKey(metadata)
  const userId = normalizeOptionalString(metadata.userId ?? metadata.user_id)
  const analysisId = normalizeOptionalString(metadata.analysisId ?? metadata.analysis_id)
  const enabled = isAiScoreCacheEnabled(env)
  const allowedByUser = isAllowedByList(userId, env.AI_SCORE_CACHE_ALLOWED_USER_IDS)
  const allowedByAnalysis = isAllowedByList(analysisId, env.AI_SCORE_CACHE_ALLOWED_ANALYSIS_IDS)

  return {
    cache_key_version: normalizeOptionalString(metadata.cacheKeyVersion) || SCORE_CACHE_KEY_VERSION,
    scoring_contract_version: normalizeOptionalString(metadata.scoringContractVersion) || SCORE_CACHE_SCORING_CONTRACT_VERSION,
    enabled,
    eligible: enabled && allowedByUser && allowedByAnalysis && keyResult.eligible,
    key_build_eligible: keyResult.eligible,
    missing_key_fields: keyResult.missingFields,
    allowed_by_user_allowlist: allowedByUser,
    allowed_by_analysis_allowlist: allowedByAnalysis,
    has_resume_fingerprint: Boolean(normalizeOptionalString(metadata.resumeFingerprint)),
    has_job_description_fingerprint: Boolean(normalizeOptionalString(metadata.jobDescriptionFingerprint)),
    provider: normalizeOptionalString(metadata.provider),
    model: normalizeOptionalString(metadata.model),
    prompt_version: normalizeOptionalString(metadata.promptVersion),
    compact_mode: normalizeCompactMode(metadata.compactMode),
  }
}
