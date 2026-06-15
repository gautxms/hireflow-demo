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

export function isAiScoreCacheEnabled(env = process.env) {
  return String(env.AI_SCORE_CACHE_ENABLED || 'false').toLowerCase() === 'true'
}

export function buildScoreCacheResumeFingerprint({ extractedText, parsedResume, canonicalResumeFields } = {}) {
  const source = canonicalResumeFields ?? parsedResume ?? extractedText
  if (source === null || source === undefined || source === '') return null

  return sha256Stable({ type: 'resume', source })
}

export function buildScoreCacheJobDescriptionFingerprint({ jobDescription, allowNoJobDescription = false } = {}) {
  const normalizedJobDescription = normalizeOptionalString(jobDescription)
  if (normalizedJobDescription) {
    return sha256Stable({ type: 'job_description', jobDescription: normalizedJobDescription })
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
    scoringContractVersion: normalizeOptionalString(scoringContractVersion),
    cacheKeyVersion: normalizeOptionalString(cacheKeyVersion),
  }

  const missingFields = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (compactMode === null || compactMode === undefined || compactMode === '') {
    missingFields.push('compactMode')
  }

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
    compact_mode: Boolean(compactMode),
  }

  return {
    eligible: true,
    key: `${required.cacheKeyVersion}:${sha256Stable(material)}`,
    missingFields: [],
    material,
  }
}

export function buildScoreCacheValue(candidate = {}, metadata = {}) {
  const score = normalizeOptionalNumber(candidate?.matchScore?.score ?? candidate?.score)

  return {
    scoring_contract_version: normalizeOptionalString(metadata.scoringContractVersion) || SCORE_CACHE_SCORING_CONTRACT_VERSION,
    score,
    score_out_of_ten: score === null ? null : roundToOneDecimal(score / 10),
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
    compact_mode: metadata.compactMode === null || metadata.compactMode === undefined || metadata.compactMode === '' ? null : Boolean(metadata.compactMode),
  }
}
