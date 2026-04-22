const CATEGORY_MESSAGES = {
  invalid_request_error: 'The configured AI model is invalid or no longer supported.',
  auth_error: 'The AI provider API key is invalid or expired.',
  rate_limit_error: 'The AI provider is rate-limiting requests right now.',
  timeout_error: 'The AI provider timed out while processing this request.',
  network_error: 'Temporary network issue while contacting the AI provider.',
  not_found_error: 'The configured AI model could not be found.',
  unknown_error: 'AI service temporarily unavailable; please retry.',
}

const NORMALIZED_PREFIX_PATTERN = /^(not_found_error|invalid_request_error|auth_error|rate_limit_error|timeout_error|network_error|unknown_error)(::\s*(.*))?$/i
const DEFAULT_ADMIN_PATH = '/admin/security'

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
  const details = extractedDetails || raw || ''

  let parsedContext = null
  try {
    parsedContext = details ? JSON.parse(details) : null
  } catch {
    parsedContext = null
  }

  const technicalDetails = parsedContext?.technicalDetails || details
  const provider = parsedContext?.provider || null
  const model = parsedContext?.model || null
  const adminPath = parsedContext?.adminPath || DEFAULT_ADMIN_PATH
  const action = parsedContext?.action || 'review_provider_settings'
  const remediationSteps = Array.isArray(parsedContext?.remediationSteps) && parsedContext.remediationSteps.length > 0
    ? parsedContext.remediationSteps
    : category === 'auth_error'
      ? [
          'Open Admin Security and update your provider API key.',
          'Confirm the key has inference permissions for the selected model.',
          'Save and retry the resume analysis.',
        ]
      : category === 'not_found_error' || category === 'invalid_request_error'
        ? [
            'Open Admin Security and review the selected provider/model.',
            'Replace retired or unsupported models with an allowed model.',
            'Save and retry the resume analysis.',
          ]
        : [
            'Wait briefly, then retry the request.',
            'If this repeats, review provider failover settings in Admin Security.',
          ]

  return {
    category,
    userMessage: CATEGORY_MESSAGES[category] || CATEGORY_MESSAGES.unknown_error,
    technicalDetails,
    provider,
    model,
    adminPath,
    action,
    remediationSteps,
    actionHint: 'Go to Admin Security',
  }
}
