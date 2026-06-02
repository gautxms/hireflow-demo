const DETERMINISTIC_CATEGORIES = new Set([
  'docx_empty_extraction',
  'docx_invalid_or_unreadable',
  'docx_dependency_missing',
  'docx_extraction_failed',
  'extraction_empty',
  'legacy_word_format',
  'resume_unsupported_legacy_doc',
  'unsupported_format',
])

const DETERMINISTIC_PATTERNS = [
  /invalid input syntax for type (integer|bigint|numeric|double precision)/i,
  /invalid input syntax for (integer|bigint|numeric|double precision)/i,
  /value too long for type/i,
  /violates (check|unique|not-null|foreign key) constraint/i,
  /column .* does not exist/i,
  /relation .* does not exist/i,
  /cannot cast type/i,
  /malformed (array|json)/i,
  /docx_empty_extraction/i,
  /docx_invalid_or_unreadable/i,
  /docx_dependency_missing/i,
  /docx_extraction_failed/i,
  /extraction_empty/i,
  /legacy_word_format/i,
  /unsupported (file )?format/i,
  /unsupported_format/i,
  /legacy \.doc files are not supported/i,
  /legacy word \.doc files are not supported/i,
  /resume_unsupported_legacy_doc::/i,
  /local request validation failed/i,
  /local payload validation failed/i,
  /payload validation failed/i,
  /resume payload is empty/i,
  /mime\/extension mismatch/i,
  /mime type .* extension .* mismatch/i,
  /extension .* mime type .* mismatch/i,
]

const RETRIABLE_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /econnreset/i,
  /econnrefused/i,
  /too many requests/i,
  /rate limit/i,
  /redis/i,
  /connection terminated unexpectedly/i,
]

function readMessage(errorLike) {
  if (errorLike instanceof Error) return String(errorLike.message || '').trim()
  return String(errorLike || '').trim()
}

function normalizeCategory(value) {
  if (value === null || value === undefined || typeof value === 'object') return null
  const normalized = String(value).trim().toLowerCase()
  return normalized || null
}

function getDeterministicCategory(errorLike) {
  const message = readMessage(errorLike)
  const prefixedCategory = normalizeCategory(message.match(/^([a-z0-9_]+)::/i)?.[1])
  const candidates = [
    normalizeCategory(errorLike?.category),
    normalizeCategory(errorLike?.extractionCategory),
    normalizeCategory(errorLike?.failureCategory),
    prefixedCategory,
  ]

  return candidates.find((category) => DETERMINISTIC_CATEGORIES.has(category)) || null
}

export class NonRetriableParseError extends Error {
  constructor(message, { cause = null, category = 'local_deterministic_failure' } = {}) {
    super(message)
    this.name = 'NonRetriableParseError'
    this.cause = cause
    this.category = category
    this.nonRetriable = true
  }
}

export function isLikelyProviderFailure(errorLike) {
  return Array.isArray(errorLike?.attempts) && errorLike.attempts.length > 0
}

export function classifyParseJobRetryability(errorLike) {
  if (!errorLike) {
    return { retryable: true, reason: 'unknown_error' }
  }

  if (errorLike instanceof NonRetriableParseError || errorLike?.nonRetriable === true) {
    return { retryable: false, reason: errorLike.category || 'marked_non_retriable' }
  }

  const deterministicCategory = getDeterministicCategory(errorLike)
  if (deterministicCategory) {
    return { retryable: false, reason: `deterministic_local_failure:${deterministicCategory}` }
  }

  const message = readMessage(errorLike)

  if (/response_truncated_error/i.test(message)) {
    return { retryable: true, reason: 'provider_response_truncated' }
  }

  if (DETERMINISTIC_PATTERNS.some((pattern) => pattern.test(message))) {
    return { retryable: false, reason: 'deterministic_local_failure' }
  }

  if (isLikelyProviderFailure(errorLike)) {
    return { retryable: true, reason: 'provider_failure' }
  }

  if (RETRIABLE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { retryable: true, reason: 'transient_failure' }
  }

  return { retryable: true, reason: 'default_retryable' }
}

export function toNonRetriableParseError(errorLike, category = 'local_deterministic_failure') {
  if (errorLike instanceof NonRetriableParseError) return errorLike
  const message = readMessage(errorLike) || 'deterministic local parse failure'
  return new NonRetriableParseError(message, { cause: errorLike, category })
}
