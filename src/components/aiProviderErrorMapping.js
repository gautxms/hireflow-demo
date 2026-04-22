const CATEGORY_MESSAGES = {
  response_format_error: 'The AI provider returned an invalid response format.',
  invalid_request_error: 'The configured AI model is invalid or no longer supported.',
  auth_error: 'The AI provider API key is invalid or expired.',
  billing_quota_error: 'The active AI provider has a billing or quota issue.',
  rate_limit_error: 'The AI provider is rate-limiting requests right now.',
  timeout_error: 'The AI provider timed out while processing this request.',
  network_error: 'Temporary network issue while contacting the AI provider.',
  ai_disabled_error: 'AI analysis is currently disabled by an administrator.',
  not_found_error: 'The configured AI model could not be found.',
  unknown_error: 'AI service temporarily unavailable; please retry.',
}

const NORMALIZED_PREFIX_PATTERN = /^(response_format_error|not_found_error|invalid_request_error|auth_error|billing_quota_error|rate_limit_error|timeout_error|network_error|ai_disabled_error|unknown_error)(::\s*(.*))?$/i
const DEFAULT_ADMIN_PATH = '/admin/security'

function sanitizeRawMessage(rawMessage) {
  return String(rawMessage || '').trim()
}

export function isStorageInfrastructureError(rawMessage) {
  const lower = sanitizeRawMessage(rawMessage).toLowerCase()
  return lower.includes('aws_s3_bucket')
    || lower.includes('s3 bucket')
    || lower.includes('s3 storage')
    || lower.includes('object storage')
    || lower.includes('storage not configured')
    || lower.includes('storage credentials')
    || lower.includes('bucket does not exist')
    || lower.includes('no such bucket')
    || lower.includes('invalidaccesskeyid')
    || lower.includes('signaturedoesnotmatch')
    || lower.includes('could not load credentials from any providers')
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

  if (
    lower.includes('response_format_error')
    || lower.includes('unexpected token')
    || lower.includes('is not valid json')
    || lower.includes('unable to parse provider json')
  ) {
    return { category: 'response_format_error', extractedDetails: '' }
  }

  if (lower.includes('not_found_error') || lower.includes('model not found') || lower.includes('resource not found')) {
    return { category: 'not_found_error', extractedDetails: '' }
  }

  if (lower.includes('invalid_request_error') || lower.includes('invalid request') || lower.includes('bad request')) {
    return { category: 'invalid_request_error', extractedDetails: '' }
  }

  if (
    lower.includes('insufficient_quota')
    || lower.includes('quota exceeded')
    || lower.includes('exceeded your current quota')
    || lower.includes('billing')
    || lower.includes('check your plan and billing details')
    || lower.includes('add credits')
  ) {
    return { category: 'billing_quota_error', extractedDetails: '' }
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
      : category === 'response_format_error'
          ? [
              'Retry once, as provider output formatting issues can be transient.',
              'If this repeats, use Admin Security to switch provider/model.',
              'Save settings and retry the resume analysis.',
            ]
          : category === 'billing_quota_error'
            ? [
                'Add credits or resolve billing for the active AI provider account.',
                'Change active provider/model in Admin Security.',
                'Test fallback provider/key and retry the resume analysis.',
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
