function normalizeString(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export function isLocalPostAiValidationFailure(error) {
  const message = String(error?.message || '').trim().toLowerCase()
  return message.startsWith('parse_failed::') || message.startsWith('scoring_failed::')
}

export function buildLocalPostAiFailureNormalizedPayload(error) {
  const details = error?.parseFailureDetails && typeof error.parseFailureDetails === 'object'
    ? error.parseFailureDetails
    : {}
  const provider = normalizeString(details.provider)
  const model = normalizeString(details.model)
  const providerChain = Array.isArray(details.attempts) && details.attempts.length > 0
    ? {
        attempts: details.attempts,
        finalOutcome: 'failed',
        fallbackTriggered: details.attempts.length > 1,
      }
    : null
  const technicalDetails = normalizeString(details.technicalDetails)
    || normalizeString(error?.message)
    || 'parse_failed::ai_response_candidate_validation_failed'

  return {
    category: 'parse_failed',
    userMessage: 'AI response failed candidate validation.',
    normalizedMessage: `parse_failed::${JSON.stringify({
      technicalDetails,
      provider,
      model,
      providerChain,
      failureType: 'ai_output_validation_failed',
      action: 'review_ai_output_validation',
    })}`,
  }
}
