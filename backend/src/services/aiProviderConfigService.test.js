import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProviderAttemptPlan } from './aiProviderConfigService.js'

test('buildProviderAttemptPlan prioritizes active provider then secondary provider', () => {
  const plan = buildProviderAttemptPlan({
    activeProvider: 'openai',
    providers: {
      openai: {
        primary: { apiKey: 'sk-openai-primary', model: 'gpt-4o-mini', source: 'admin-console' },
        fallback: { apiKey: 'sk-openai-fallback', model: 'gpt-4.1-mini', source: 'admin-console' },
      },
      anthropic: {
        primary: { apiKey: 'sk-ant-primary', model: 'claude-3-5-sonnet-20241022', source: 'admin-console' },
        fallback: { apiKey: 'sk-ant-fallback', model: 'claude-3-5-haiku-20241022', source: 'admin-console' },
      },
    },
  })

  assert.deepEqual(
    plan.map((entry) => `${entry.provider}:${entry.keyLabel}`),
    ['openai:primary', 'openai:fallback', 'anthropic:primary', 'anthropic:fallback'],
  )
})

test('buildProviderAttemptPlan removes entries without API keys', () => {
  const plan = buildProviderAttemptPlan({
    activeProvider: 'anthropic',
    providers: {
      anthropic: {
        primary: { apiKey: '', model: 'claude-3-5-sonnet-20241022', source: 'env' },
        fallback: { apiKey: 'sk-ant-fallback', model: 'claude-3-5-haiku-20241022', source: 'admin-console' },
      },
      openai: {
        primary: { apiKey: 'sk-openai-primary', model: 'gpt-4o-mini', source: 'admin-console' },
        fallback: { apiKey: '', model: 'gpt-4.1-mini', source: 'env' },
      },
    },
  })

  assert.deepEqual(
    plan.map((entry) => `${entry.provider}:${entry.keyLabel}`),
    ['anthropic:fallback', 'openai:primary'],
  )
})
