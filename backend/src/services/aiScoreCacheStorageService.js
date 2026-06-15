import { pool as defaultPool } from '../db/client.js'
import {
  SCORE_CACHE_KEY_VERSION,
  SCORE_CACHE_SCORING_CONTRACT_VERSION,
} from './aiScoreCacheService.js'

const REQUIRED_STORAGE_FIELDS = [
  'cache_key',
  'cache_key_version',
  'scoring_contract_version',
  'canonical_score',
  'score_out_of_ten',
  'resume_fingerprint',
  'job_description_fingerprint',
]

const SAFE_METADATA_KEYS = new Set([
  'schema_version',
  'source',
  'reason',
  'cache_key_version',
  'scoring_contract_version',
])

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

function normalizeSafeToken(value) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  if (/\.(pdf|docx?|txt)$/i.test(normalized)) return null
  return /^[a-z0-9_.:-]+$/i.test(normalized) ? normalized : null
}

function pickSafeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key, value]) => SAFE_METADATA_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => [key, value]),
  )
}

function validateStoragePayload(payload) {
  const missingFields = REQUIRED_STORAGE_FIELDS.filter((field) => {
    if (field === 'canonical_score' || field === 'score_out_of_ten') return payload[field] === null || payload[field] === undefined
    return !payload[field]
  })

  return {
    eligible: missingFields.length === 0,
    valid: missingFields.length === 0,
    missingFields,
  }
}

export function buildSafeScoreCacheStoragePayload(cacheKeyResult = {}, cacheValue = {}, metadata = {}) {
  const material = cacheKeyResult.material || {}
  const payload = {
    cache_key: normalizeOptionalString(cacheKeyResult.key ?? cacheKeyResult.cache_key),
    cache_key_version: normalizeOptionalString(material.cache_key_version ?? metadata.cacheKeyVersion ?? metadata.cache_key_version) || SCORE_CACHE_KEY_VERSION,
    scoring_contract_version: normalizeOptionalString(
      cacheValue.scoring_contract_version ?? material.scoring_contract_version ?? metadata.scoringContractVersion ?? metadata.scoring_contract_version,
    ) || SCORE_CACHE_SCORING_CONTRACT_VERSION,
    canonical_score: normalizeOptionalNumber(cacheValue.canonical_score ?? cacheValue.score),
    score_out_of_ten: normalizeOptionalNumber(cacheValue.score_out_of_ten),
    canonical_score_source: normalizeSafeToken(cacheValue.canonical_score_source),
    canonical_score_context: normalizeSafeToken(cacheValue.canonical_score_context),
    provider: normalizeSafeToken(material.provider ?? metadata.provider),
    model: normalizeSafeToken(material.model ?? metadata.model),
    prompt_version: normalizeSafeToken(material.prompt_version ?? metadata.promptVersion ?? metadata.prompt_version),
    compact_mode: normalizeSafeToken(material.compact_mode ?? metadata.compactMode ?? metadata.compact_mode),
    resume_fingerprint: normalizeOptionalString(material.resume_fingerprint ?? metadata.resumeFingerprint ?? metadata.resume_fingerprint),
    job_description_fingerprint: normalizeOptionalString(
      material.job_description_fingerprint ?? metadata.jobDescriptionFingerprint ?? metadata.job_description_fingerprint,
    ),
    metadata: pickSafeMetadata(metadata),
  }

  return { ...validateStoragePayload(payload), payload }
}

export async function upsertScoreCacheEntry(value, db = defaultPool) {
  const validation = validateStoragePayload(value || {})
  if (!validation.valid) return { stored: false, ...validation }

  const safeValue = {
    ...value,
    canonical_score_source: normalizeSafeToken(value.canonical_score_source),
    canonical_score_context: normalizeSafeToken(value.canonical_score_context),
    provider: normalizeSafeToken(value.provider),
    model: normalizeSafeToken(value.model),
    prompt_version: normalizeSafeToken(value.prompt_version),
    compact_mode: normalizeSafeToken(value.compact_mode),
    metadata: pickSafeMetadata(value.metadata),
  }

  const result = await db.query(
    `INSERT INTO ai_score_cache (
      cache_key, cache_key_version, scoring_contract_version, canonical_score, score_out_of_ten,
      canonical_score_source, canonical_score_context, provider, model, prompt_version, compact_mode,
      resume_fingerprint, job_description_fingerprint, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
    ON CONFLICT (cache_key) DO UPDATE SET
      cache_key_version = EXCLUDED.cache_key_version,
      scoring_contract_version = EXCLUDED.scoring_contract_version,
      canonical_score = EXCLUDED.canonical_score,
      score_out_of_ten = EXCLUDED.score_out_of_ten,
      canonical_score_source = EXCLUDED.canonical_score_source,
      canonical_score_context = EXCLUDED.canonical_score_context,
      provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      prompt_version = EXCLUDED.prompt_version,
      compact_mode = EXCLUDED.compact_mode,
      resume_fingerprint = EXCLUDED.resume_fingerprint,
      job_description_fingerprint = EXCLUDED.job_description_fingerprint,
      metadata = EXCLUDED.metadata
    RETURNING *`,
    [
      safeValue.cache_key, safeValue.cache_key_version, safeValue.scoring_contract_version, safeValue.canonical_score, safeValue.score_out_of_ten,
      safeValue.canonical_score_source, safeValue.canonical_score_context, safeValue.provider, safeValue.model, safeValue.prompt_version, safeValue.compact_mode,
      safeValue.resume_fingerprint, safeValue.job_description_fingerprint, JSON.stringify(safeValue.metadata),
    ],
  )

  return { stored: true, eligible: true, valid: true, entry: result.rows[0] || null }
}

export async function getScoreCacheEntry(cacheKey, db = defaultPool) {
  const normalizedCacheKey = normalizeOptionalString(cacheKey)
  if (!normalizedCacheKey) return { found: false, eligible: false, missingFields: ['cache_key'], entry: null }

  const result = await db.query('SELECT * FROM ai_score_cache WHERE cache_key = $1 LIMIT 1', [normalizedCacheKey])
  return { found: result.rows.length > 0, eligible: true, entry: result.rows[0] || null }
}

export async function markScoreCacheHit(cacheKey, db = defaultPool) {
  const normalizedCacheKey = normalizeOptionalString(cacheKey)
  if (!normalizedCacheKey) return { updated: false, eligible: false, missingFields: ['cache_key'], entry: null }

  const result = await db.query(
    `UPDATE ai_score_cache
      SET hit_count = hit_count + 1,
          last_used_at = NOW()
      WHERE cache_key = $1
      RETURNING *`,
    [normalizedCacheKey],
  )

  return { updated: result.rows.length > 0, eligible: true, entry: result.rows[0] || null }
}
