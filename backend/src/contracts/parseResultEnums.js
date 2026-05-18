export const PARSE_OUTCOMES = Object.freeze(['success', 'partial', 'failed'])

export const FAILURE_CATEGORIES = Object.freeze([
  'corrupt_or_unreadable',
  'ai_output_validation_failed',
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
  const raw = String(value).trim()
  const normalized = raw.toLowerCase()
  if (normalized.startsWith('parse_failed::')) {
    const payload = raw.slice('parse_failed::'.length).trim()
    try {
      const parsed = JSON.parse(payload)
      const structured = String(parsed?.failureType || '').trim().toLowerCase()
      if (FAILURE_CATEGORY_SET.has(structured)) return structured
      const technicalDetails = String(parsed?.technicalDetails || '').trim().toLowerCase()
      if (technicalDetails.includes('ai_failure_placeholder')) return 'ai_output_validation_failed'
    } catch {
      if (payload.toLowerCase().includes('ai_failure_placeholder')) return 'ai_output_validation_failed'
    }
    return fallback
  }
  return FAILURE_CATEGORY_SET.has(normalized) ? normalized : fallback
}
