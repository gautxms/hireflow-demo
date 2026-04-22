import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRoleSafeErrorView,
  isStorageInfrastructureError,
  mapProviderError,
} from './aiProviderErrorMapping.js'

test('mapProviderError maps invalid request errors to admin security guidance', () => {
  const result = mapProviderError('invalid_request_error: model is not allowed')

  assert.equal(result.category, 'invalid_request_error')
  assert.equal(result.technicalDetails, 'invalid_request_error: model is not allowed')
  assert.equal(result.actionHint, 'Go to Admin Security')
  assert.equal(result.adminPath, '/admin/security')
})

test('mapProviderError maps invalid api key errors to key guidance', () => {
  const result = mapProviderError('Authentication failed due to invalid API key')

  assert.equal(result.category, 'auth_error')
  assert.equal(result.remediationSteps.length > 0, true)
})

test('mapProviderError maps timeouts to retry guidance', () => {
  const result = mapProviderError('Request timed out while contacting provider')

  assert.equal(result.category, 'timeout_error')
})

test('mapProviderError maps provider rate limits to retry guidance', () => {
  const result = mapProviderError('rate_limit_error::provider returned 429')

  assert.equal(result.category, 'rate_limit_error')
  assert.equal(result.technicalDetails, 'provider returned 429')
})

test('mapProviderError maps provider billing/quota failures with explicit remediation', () => {
  const result = mapProviderError('insufficient_quota: You exceeded your current quota, please check your plan and billing details')

  assert.equal(result.category, 'billing_quota_error')
  assert.deepEqual(result.remediationSteps, [
    'Add credits or resolve billing for the active AI provider account.',
    'Change active provider/model in Admin Security.',
    'Test fallback provider/key and retry the resume analysis.',
  ])
})

test('mapProviderError parses structured backend context for retired model guidance', () => {
  const result = mapProviderError('not_found_error::{"technicalDetails":"Model claude-2.0 retired","provider":"anthropic","model":"claude-2.0","adminPath":"/admin/security","action":"review_model_configuration","remediationSteps":["Replace retired model","Save settings","Retry"]}')

  assert.equal(result.category, 'not_found_error')
  assert.equal(result.provider, 'anthropic')
  assert.equal(result.model, 'claude-2.0')
  assert.equal(result.remediationSteps[0], 'Replace retired model')
  assert.equal(result.actionHint, 'Go to Admin Security')
})

test('mapProviderError maps admin disablement to governance guidance', () => {
  const result = mapProviderError('ai_disabled_error::AI resume analysis disabled')

  assert.equal(result.category, 'ai_disabled_error')
})

test('mapProviderError maps provider response format errors with actionable retry guidance', () => {
  const result = mapProviderError('response_format_error::{"technicalDetails":"Unexpected token ` in JSON","provider":"openai","model":"gpt-4o-mini"}')

  assert.equal(result.category, 'response_format_error')
  assert.equal(result.provider, 'openai')
  assert.equal(result.model, 'gpt-4o-mini')
  assert.equal(result.remediationSteps.length > 0, true)
})

test('buildRoleSafeErrorView hides admin links/details for customer view', () => {
  const mapped = mapProviderError('response_format_error::{"technicalDetails":"raw provider payload snippet","provider":"openai","model":"gpt-4o-mini"}')
  const customerView = buildRoleSafeErrorView(mapped, { isAdmin: false, isDevelopment: false })

  assert.equal(customerView.providerErrorGuidance, null)
  assert.equal(customerView.technicalErrorDetails, '')
  assert.equal(customerView.userMessage.includes('contact support'), true)
})

test('buildRoleSafeErrorView includes admin diagnostics in admin/development view', () => {
  const mapped = mapProviderError('response_format_error::{"technicalDetails":"diagnostic details","provider":"openai","model":"gpt-4o-mini"}')
  const adminView = buildRoleSafeErrorView(mapped, { isAdmin: true, isDevelopment: false })

  assert.equal(adminView.providerErrorGuidance?.adminPath, '/admin/security')
  assert.equal(adminView.technicalErrorDetails, 'diagnostic details')
})

test('isStorageInfrastructureError only flags storage-specific upload failures', () => {
  assert.equal(isStorageInfrastructureError('Missing AWS_S3_BUCKET env var'), true)
  assert.equal(isStorageInfrastructureError('object storage credentials are invalid'), true)
  assert.equal(isStorageInfrastructureError('Could not load credentials from any providers'), true)
  assert.equal(isStorageInfrastructureError('response_format_error::Unexpected token ` in JSON'), false)
  assert.equal(isStorageInfrastructureError('insufficient_quota: check your plan and billing details'), false)
  assert.equal(isStorageInfrastructureError('openai access denied due to billing hold'), false)
})
