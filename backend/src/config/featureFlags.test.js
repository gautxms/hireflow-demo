import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const ORIGINAL_ENV = {
  FF_ENABLE_PLACEHOLDER_RETRY_ROLLOUT: process.env.FF_ENABLE_PLACEHOLDER_RETRY_ROLLOUT,
  FF_ENABLE_EXTENDED_RESUME_SIGNALS_ROLLOUT: process.env.FF_ENABLE_EXTENDED_RESUME_SIGNALS_ROLLOUT,
  FF_ENABLE_VALIDATION_SAMPLE_LOGGING_ROLLOUT: process.env.FF_ENABLE_VALIDATION_SAMPLE_LOGGING_ROLLOUT,
}

async function loadWithEnv(env = {}) {
  for (const key of Object.keys(ORIGINAL_ENV)) {
    if (typeof env[key] === 'undefined') delete process.env[key]
    else process.env[key] = env[key]
  }
  return import(`./featureFlags.js?scenario=${Date.now()}-${Math.random()}`)
}

test('defaults all rollout flags to enabled when env is missing', async () => {
  const mod = await loadWithEnv({})
  const flags = mod.getRolloutConfig('user-1:resume-1')
  assert.equal(flags.enable_placeholder_retry, true)
  assert.equal(flags.enable_extended_resume_signals, true)
  assert.equal(flags.enable_validation_sample_logging, true)
})

test('uses deterministic cohort rollout percentages', async () => {
  const mod = await loadWithEnv({
    FF_ENABLE_PLACEHOLDER_RETRY_ROLLOUT: '10',
    FF_ENABLE_EXTENDED_RESUME_SIGNALS_ROLLOUT: '50',
    FF_ENABLE_VALIDATION_SAMPLE_LOGGING_ROLLOUT: '100',
  })

  assert.equal(mod.getRolloutPercent('enable_placeholder_retry'), 10)
  assert.equal(mod.getRolloutPercent('enable_extended_resume_signals'), 50)
  assert.equal(mod.getRolloutPercent('enable_validation_sample_logging'), 100)

  const a = mod.getRolloutConfig('stable-identity-123')
  const b = mod.getRolloutConfig('stable-identity-123')
  assert.deepEqual(a, b)
})

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (typeof value === 'undefined') delete process.env[key]
    else process.env[key] = value
  }
})
