const CATEGORY_MESSAGES = {
  invalid_request_error: 'AI model configuration issue in Admin Security.',
  auth_error: 'AI key invalid or expired.',
  rate_limit_error: 'AI service temporarily unavailable; please retry.',
  timeout_error: 'AI service temporarily unavailable; please retry.',
  network_error: 'AI service temporarily unavailable; please retry.',
  not_found_error: 'AI model configuration issue in Admin Security.',
  unknown_error: 'AI service temporarily unavailable; please retry.',
}

const NORMALIZED_PREFIX_PATTERN = /^(not_found_error|invalid_request_error|auth_error|rate_limit_error|timeout_error|network_error|unknown_error)(::\s*(.*))?$/i

function sanitizeRawMessage(rawMessage) {
  return String(rawMessage || '').trim()
}

export function detectProviderErrorCategory(rawMessage) {
  const normalized = sanitizeRawMessage(rawMessage)
  const lower = normalized.toLowerCase()

  const normalizedPrefixMatch = normalized.match(NORMALIZED_PREFIX_PATTERN)
  if (normalizedPrefixMatch) {
    return {
      category: normalizedPrefixMatch[1].toLowerCase(),
      extractedDetails: sanitizeRawMessage(normalizedPrefixMatch[3]),
    }
  }

  if (lower.includes('not_found_error') || lower.includes('model not found') || lower.includes('resource not found')) {
    return { category: 'not_found_error', extractedDetails: '' }
  }

  if (lower.includes('invalid_request_error') || lower.includes('invalid request') || lower.includes('bad request')) {
    return { category: 'invalid_request_error', extractedDetails: '' }
  }

  if (
    lower.includes('authentication')
    || lower.includes('unauthorized')
    || lower.includes('api key')
    || lower.includes('invalid api key')
    || lower.includes('forbidden')
    || lower.includes('permission denied')
  ) {
    return { category: 'auth_error', extractedDetails: '' }
  }

  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return { category: 'rate_limit_error', extractedDetails: '' }
  }

  if (
    lower.includes('timeout')
    || lower.includes('timed out')
    || lower.includes('econnreset')
    || lower.includes('econnrefused')
    || lower.includes('network')
    || lower.includes('failed to fetch')
    || lower.includes('503')
    || lower.includes('504')
  ) {
    return { category: 'timeout_error', extractedDetails: '' }
  }

  return { category: 'unknown_error', extractedDetails: '' }
}

export function mapProviderError(rawMessage) {
  const raw = sanitizeRawMessage(rawMessage)
  const { category, extractedDetails } = detectProviderErrorCategory(raw)

  return {
    category,
    userMessage: CATEGORY_MESSAGES[category] || CATEGORY_MESSAGES.unknown_error,
    technicalDetails: extractedDetails || raw || '',
  }
}
