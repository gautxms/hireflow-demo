import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeProviderError } from './parseProviderError.js'
import { buildLocalPostAiFailureNormalizedPayload, isLocalPostAiValidationFailure } from './parseFailureMapping.js'

test('provider unavailable errors remain provider unavailable', () => {
  const normalized = normalizeProviderError(new Error('timeout while calling provider'))
  assert.equal(normalized.category, 'timeout_error')
  assert.equal(normalized.userMessage, 'AI service temporarily unavailable; please retry.')
})

test('ai called but candidate validation fails maps to validation failure with provider/model preserved', () => {
  const error = new Error('parse_failed::ai_failure_placeholder')
  error.parseFailureDetails = {
    provider: 'anthropic-primary',
    model: 'claude-haiku-4-5-20251001',
    technicalDetails: 'parse_failed::ai_failure_placeholder',
    attempts: [
      {
        success: true,
        provider: 'anthropic-primary',
        model: 'claude-haiku-4-5-20251001',
        tokenUsage: { usageAvailable: true, inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      },
    ],
  }

  assert.equal(isLocalPostAiValidationFailure(error), true)
  const normalized = buildLocalPostAiFailureNormalizedPayload(error)
  assert.equal(normalized.category, 'parse_failed')
  assert.equal(normalized.userMessage, 'AI response failed candidate validation.')
  assert.match(normalized.normalizedMessage, /"provider":"anthropic-primary"/)
  assert.match(normalized.normalizedMessage, /"model":"claude-haiku-4-5-20251001"/)
  assert.match(normalized.normalizedMessage, /"providerChain":\{"attempts":\[/)
})

test('ai called and no scored candidates remain does not serialize null provider/model/providerChain', () => {
  const error = new Error('parse_failed::ai_failure_placeholder')
  error.parseFailureDetails = {
    provider: 'anthropic-primary',
    model: 'claude-haiku-4-5-20251001',
    attempts: [{ success: true, provider: 'anthropic-primary', model: 'claude-haiku-4-5-20251001' }],
  }

  const normalized = buildLocalPostAiFailureNormalizedPayload(error)
  assert.doesNotMatch(normalized.normalizedMessage, /"provider":null/)
  assert.doesNotMatch(normalized.normalizedMessage, /"model":null/)
  assert.doesNotMatch(normalized.normalizedMessage, /"providerChain":null/)
})

test('analysis status aggregation remains failed when one success and two failures exist', () => {
  const statuses = ['complete', 'failed', 'failed']
  const hasFailed = statuses.includes('failed')
  const allComplete = statuses.every((status) => status === 'complete')
  const aggregate = allComplete ? 'complete' : (hasFailed ? 'failed' : 'processing')
  assert.equal(aggregate, 'failed')
})
