import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const ORIGINAL_ENV = {
  ANTHROPIC_ALLOWED_MODELS: process.env.ANTHROPIC_ALLOWED_MODELS,
  ANTHROPIC_RESUME_MODEL: process.env.ANTHROPIC_RESUME_MODEL,
}

async function loadConfigWithEnv({ allowed, resumeModel }) {
  if (typeof allowed === 'undefined') {
    delete process.env.ANTHROPIC_ALLOWED_MODELS
  } else {
    process.env.ANTHROPIC_ALLOWED_MODELS = allowed
  }

  if (typeof resumeModel === 'undefined') {
    delete process.env.ANTHROPIC_RESUME_MODEL
  } else {
    process.env.ANTHROPIC_RESUME_MODEL = resumeModel
  }

  return import(`./aiModels.js?scenario=${Date.now()}-${Math.random()}`)
}

test('uses an active default model when env override is not provided', async () => {
  const module = await loadConfigWithEnv({
    allowed: undefined,
    resumeModel: undefined,
  })

  assert.equal(module.AI_MODEL_CONFIG.defaultModel, 'claude-sonnet-4-20250514')
  assert.equal(module.isAllowedAnthropicModel(module.AI_MODEL_CONFIG.defaultModel), true)
})

test('flags invalid or retired env default model against allowlist', async () => {
  const module = await loadConfigWithEnv({
    allowed: 'claude-sonnet-4-20250514,claude-3-7-sonnet-20250219',
    resumeModel: 'claude-3-5-sonnet-20241022',
  })

  assert.equal(module.AI_MODEL_CONFIG.defaultModel, 'claude-3-5-sonnet-20241022')
  assert.equal(module.isAllowedAnthropicModel(module.AI_MODEL_CONFIG.defaultModel), false)

  const warnings = module.getAnthropicModelWarnings([
    { source: 'env.ANTHROPIC_RESUME_MODEL', model: module.AI_MODEL_CONFIG.defaultModel },
  ])

  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].source, 'env.ANTHROPIC_RESUME_MODEL')
})

test('normalizes allowlist and falls back to active models for empty values', async () => {
  const module = await loadConfigWithEnv({
    allowed: ' , claude-sonnet-4-20250514, claude-sonnet-4-20250514 ,,claude-3-7-sonnet-20250219 ',
    resumeModel: undefined,
  })

  assert.deepEqual(module.AI_MODEL_CONFIG.allowedModels, [
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219',
  ])

  const fallbackModule = await loadConfigWithEnv({
    allowed: ' , , ',
    resumeModel: undefined,
  })

  assert.equal(fallbackModule.AI_MODEL_CONFIG.allowedModels.length > 0, true)
  assert.equal(fallbackModule.AI_MODEL_CONFIG.allowedModels.includes('claude-sonnet-4-20250514'), true)
})

after(() => {
  if (typeof ORIGINAL_ENV.ANTHROPIC_ALLOWED_MODELS === 'undefined') {
    delete process.env.ANTHROPIC_ALLOWED_MODELS
  } else {
    process.env.ANTHROPIC_ALLOWED_MODELS = ORIGINAL_ENV.ANTHROPIC_ALLOWED_MODELS
  }

  if (typeof ORIGINAL_ENV.ANTHROPIC_RESUME_MODEL === 'undefined') {
    delete process.env.ANTHROPIC_RESUME_MODEL
  } else {
    process.env.ANTHROPIC_RESUME_MODEL = ORIGINAL_ENV.ANTHROPIC_RESUME_MODEL
  }
})
