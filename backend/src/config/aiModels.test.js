import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const ORIGINAL_ENV = {
  ANTHROPIC_ALLOWED_MODELS: process.env.ANTHROPIC_ALLOWED_MODELS,
  ANTHROPIC_RESUME_MODEL: process.env.ANTHROPIC_RESUME_MODEL,
  OPENAI_ALLOWED_MODELS: process.env.OPENAI_ALLOWED_MODELS,
  OPENAI_RESUME_MODEL: process.env.OPENAI_RESUME_MODEL,
}

async function loadConfigWithEnv({ anthropicAllowed, anthropicResumeModel, openaiAllowed, openaiResumeModel }) {
  if (typeof anthropicAllowed === 'undefined') delete process.env.ANTHROPIC_ALLOWED_MODELS
  else process.env.ANTHROPIC_ALLOWED_MODELS = anthropicAllowed

  if (typeof anthropicResumeModel === 'undefined') delete process.env.ANTHROPIC_RESUME_MODEL
  else process.env.ANTHROPIC_RESUME_MODEL = anthropicResumeModel

  if (typeof openaiAllowed === 'undefined') delete process.env.OPENAI_ALLOWED_MODELS
  else process.env.OPENAI_ALLOWED_MODELS = openaiAllowed

  if (typeof openaiResumeModel === 'undefined') delete process.env.OPENAI_RESUME_MODEL
  else process.env.OPENAI_RESUME_MODEL = openaiResumeModel

  return import(`./aiModels.js?scenario=${Date.now()}-${Math.random()}`)
}

test('builds provider bootstrap defaults with optional env seed models', async () => {
  const module = await loadConfigWithEnv({
    anthropicAllowed: 'claude-sonnet-4-20250514,claude-3-7-sonnet-20250219',
    anthropicResumeModel: 'claude-sonnet-4-20250514',
    openaiAllowed: 'gpt-4.1-mini',
    openaiResumeModel: 'gpt-4o-mini',
  })

  assert.equal(module.PROVIDER_MODEL_BOOTSTRAP.anthropic.defaultModel, 'claude-sonnet-4-20250514')
  assert.deepEqual(module.PROVIDER_MODEL_BOOTSTRAP.anthropic.seedModels, [
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219',
  ])
  assert.deepEqual(module.PROVIDER_MODEL_BOOTSTRAP.openai.seedModels, ['gpt-4.1-mini', 'gpt-4o-mini'])
})

test('accepts flexible model ids but rejects empty/whitespace format', async () => {
  const module = await loadConfigWithEnv({})
  assert.equal(module.isValidModelFormat('gpt-4.1-mini'), true)
  assert.equal(module.isValidModelFormat('claude-sonnet-4-20250514'), true)
  assert.equal(module.isValidModelFormat('  '), false)
  assert.equal(module.isValidModelFormat('model with spaces'), false)
})

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (typeof value === 'undefined') delete process.env[key]
    else process.env[key] = value
  }
})
