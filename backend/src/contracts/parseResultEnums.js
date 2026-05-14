export const PARSE_OUTCOMES = Object.freeze(['success', 'partial', 'failed'])

export const FAILURE_CATEGORIES = Object.freeze([
  'corrupt_or_unreadable',
  'encrypted_or_password_protected_pdf',
  'image_only_low_ocr',
  'unsupported_encoding_or_format',
  'extraction_failed',
  'response_format_error',
  'response_truncated_error',
  'invalid_request_error',
  'not_found_error',
  'auth_error',
  'billing_quota_error',
  'rate_limit_error',
  'timeout_error',
  'network_error',
  'unknown_error',
  'unknown',
])

const PARSE_OUTCOME_SET = new Set(PARSE_OUTCOMES)
const FAILURE_CATEGORY_SET = new Set(FAILURE_CATEGORIES)

export function normalizeParseOutcome(value, fallback = 'success') {
  const normalized = String(value || '').trim().toLowerCase()
  return PARSE_OUTCOME_SET.has(normalized) ? normalized : fallback
}

export function normalizeFailureCategory(value, { fallback = null } = {}) {
  if (value == null || value === '') return null
  const normalized = String(value).trim().toLowerCase()
  return FAILURE_CATEGORY_SET.has(normalized) ? normalized : fallback
}
