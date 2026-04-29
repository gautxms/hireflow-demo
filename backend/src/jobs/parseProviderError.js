const MAX_TECHNICAL_DETAILS_LENGTH = 500
const ADMIN_SECURITY_PATH = '/admin/security'

const CATEGORY_MESSAGES = {
  response_format_error: 'AI response format issue; retry or adjust provider/model settings.',
  response_truncated_error: 'AI response was truncated before completion; retry or switch provider/model.',
  invalid_request_error: 'AI model configuration issue in Admin Security.',
  not_found_error: 'AI model configuration issue in Admin Security.',
  auth_error: 'AI key invalid or expired.',
  billing_quota_error: 'AI provider billing/quota issue; update credits or switch provider.',
  rate_limit_error: 'AI service temporarily unavailable; please retry.',
  timeout_error: 'AI service temporarily unavailable; please retry.',
  network_error: 'AI service temporarily unavailable; please retry.',
  unknown_error: 'AI service temporarily unavailable; please retry.',
}

const NORMALIZED_PREFIX_PATTERN = /^(response_format_error|response_truncated_error|not_found_error|invalid_request_error|auth_error|billing_quota_error|rate_limit_error|timeout_error|network_error|unknown_error)(::\s*(.*))?$/i

function toMessage(value) {
  if (value instanceof Error) {
    return String(value.message || '').trim()
  }

  return String(value || '').trim()
}

function extractAttemptContext(errorLike) {
  const attempts = Array.isArray(errorLike?.attempts) ? errorLike.attempts : []
  const lastAttempt = [...attempts].reverse().find((attempt) => attempt && !attempt.success)
  if (!lastAttempt) {
    return { provider: null, model: null }
  }

  const providerLabel = String(lastAttempt.provider || '').trim()
  const provider = providerLabel.includes('-') ? providerLabel.split('-')[0] : providerLabel || null
  const model = String(lastAttempt.model || '').trim() || null
  return { provider, model }
}

function extractProviderAndModel(message = '', errorLike = null) {
  const contextual = extractAttemptContext(errorLike)
  const lower = String(message || '').toLowerCase()

  const providerFromMessage = lower.includes('anthropic')
    ? 'anthropic'
    : lower.includes('openai')
      ? 'openai'
      : null

  const modelMatch = String(message || '').match(/model(?:\s+name)?(?:\s+is|\s*=|:)?\s*["']?([a-z0-9][a-z0-9._:-]+)["']?/i)
  const modelFromMessage = modelMatch?.[1] ? String(modelMatch[1]).trim() : null

  return {
    provider: contextual.provider || providerFromMessage,
    model: contextual.model || modelFromMessage,
  }
}

function buildHints(category, { provider, model } = {}) {
  const contextLabel = [provider, model].filter(Boolean).join(' / ')
  const modelStep = contextLabel
    ? `Verify ${contextLabel} is configured as an active provider/model pair.`
    : 'Verify the configured provider/model pair in Admin Security.'

  if (category === 'not_found_error' || category === 'invalid_request_error') {
    return {
      action: 'review_model_configuration',
      adminPath: ADMIN_SECURITY_PATH,
      remediationSteps: [
        modelStep,
        'Replace retired or unsupported models with an allowed model.',
        'Save changes and retry the resume analysis.',
      ],
    }
  }

  if (category === 'auth_error') {
    return {
      action: 'rotate_provider_api_key',
      adminPath: ADMIN_SECURITY_PATH,
      remediationSteps: [
        provider ? `Update the ${provider} API key in Admin Security.` : 'Update the provider API key in Admin Security.',
        'Confirm key scope includes model inference permissions.',
        'Save credentials and retry the resume analysis.',
      ],
    }
  }

  if (category === 'billing_quota_error') {
    return {
      action: 'resolve_provider_billing_or_quota',
      adminPath: ADMIN_SECURITY_PATH,
      remediationSteps: [
        'Add credits or resolve billing for the active AI provider account.',
        'Change the active provider/model pair in Admin Security.',
        'Test fallback provider/key and retry the resume analysis.',
      ],
    }
  }

  if (category === 'rate_limit_error' || category === 'timeout_error' || category === 'network_error') {
    return {
      action: 'retry_or_failover_provider',
      adminPath: ADMIN_SECURITY_PATH,
      remediationSteps: [
        'Retry after a short delay to allow provider capacity to recover.',
        'If repeated, switch to fallback provider/key in Admin Security.',
        'Review provider status dashboard for active incidents.',
      ],
    }
  }

  if (category === 'response_format_error' || category === 'response_truncated_error') {
    return {
      action: 'retry_or_adjust_provider_model',
      adminPath: ADMIN_SECURITY_PATH,
      remediationSteps: [
        'Retry once; transient provider formatting issues can self-resolve.',
        modelStep,
        'If persistent, switch to a different supported model or fallback provider.',
      ],
    }
  }

  return {
    action: 'review_provider_settings',
    adminPath: ADMIN_SECURITY_PATH,
    remediationSteps: [
      'Check provider and model settings in Admin Security.',
      'Retry once after confirming credentials and model availability.',
    ],
  }
}

export function detectProviderErrorCategory(errorLike) {
  const message = toMessage(errorLike)
  const lower = message.toLowerCase()

  const normalizedPrefixMatch = message.match(NORMALIZED_PREFIX_PATTERN)
  if (normalizedPrefixMatch) {
    return {
      category: normalizedPrefixMatch[1].toLowerCase(),
      extractedDetails: String(normalizedPrefixMatch[3] || '').trim(),
    }
  }

  if (
    lower.includes('response_truncated_error')
    || lower.includes('output was truncated')
    || lower.includes('max_tokens')
    || lower.includes('stop_reason')
  ) {
    return { category: 'response_truncated_error', extractedDetails: '' }
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

export function normalizeProviderError(errorLike) {
  const technicalDetails = toMessage(errorLike).slice(0, MAX_TECHNICAL_DETAILS_LENGTH)
  const { category, extractedDetails } = detectProviderErrorCategory(technicalDetails)
  let parsedDetails = null
  try {
    parsedDetails = extractedDetails ? JSON.parse(extractedDetails) : null
  } catch {
    parsedDetails = null
  }
  const scopedTechnicalDetails = parsedDetails?.technicalDetails || extractedDetails || technicalDetails || 'Unknown parse error'
  const providerFromDetails = parsedDetails?.provider ? String(parsedDetails.provider).trim() : null
  const modelFromDetails = parsedDetails?.model ? String(parsedDetails.model).trim() : null
  const { provider: detectedProvider, model: detectedModel } = extractProviderAndModel(scopedTechnicalDetails, errorLike)
  const provider = providerFromDetails || detectedProvider
  const model = modelFromDetails || detectedModel
  const hints = buildHints(category, { provider, model })
  const serializedDetails = JSON.stringify({
    technicalDetails: scopedTechnicalDetails,
    provider,
    model,
    ...hints,
  })

  return {
    category,
    userMessage: CATEGORY_MESSAGES[category] || CATEGORY_MESSAGES.unknown_error,
    technicalDetails: scopedTechnicalDetails,
    provider,
    model,
    ...hints,
    normalizedMessage: `${category}::${serializedDetails}`,
  }
}
