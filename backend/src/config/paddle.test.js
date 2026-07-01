import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePaddleConfig } from './paddle.js'

test('resolvePaddleConfig prefers sandbox variables when environment is sandbox', () => {
  const cfg = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_API_KEY: 'live_key',
    PADDLE_CLIENT_TOKEN: 'live_token',
    PADDLE_MONTHLY_PRICE_ID: 'pri_live_m',
    PADDLE_SANDBOX_API_KEY: 'sb_key',
    PADDLE_SANDBOX_CLIENT_TOKEN: 'sb_token',
    PADDLE_SANDBOX_MONTHLY_PRICE_ID: 'pri_sb_m',
    PADDLE_SANDBOX_ANNUAL_PRICE_ID: 'pri_sb_a',
  })

  assert.equal(cfg.environment, 'sandbox')
  assert.equal(cfg.apiKey, 'sb_key')
  assert.equal(cfg.clientToken, 'sb_token')
  assert.equal(cfg.priceIdsByPlan.monthly, 'pri_sb_m')
  assert.equal(cfg.priceIdsByPlan.annual, 'pri_sb_a')
})

test('resolvePaddleConfig keeps production values in production', () => {
  const cfg = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_API_KEY: 'live_key',
    PADDLE_CLIENT_TOKEN: 'live_token',
    PADDLE_MONTHLY_PRICE_ID: 'pri_live_m',
    PADDLE_ANNUAL_PRICE_ID: 'pri_live_a',
    PADDLE_SANDBOX_API_KEY: 'sb_key',
  })

  assert.equal(cfg.environment, 'production')
  assert.equal(cfg.apiKey, 'live_key')
  assert.equal(cfg.clientToken, 'live_token')
  assert.equal(cfg.priceIdsByPlan.monthly, 'pri_live_m')
  assert.equal(cfg.priceIdsByPlan.annual, 'pri_live_a')
})

test('resolvePaddleConfig exposes test-monthly price only when hidden checkout is enabled', () => {
  const disabled = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_TEST_MONTHLY_PRICE_ID: 'pri_test_monthly',
    PADDLE_ENABLE_TEST_CHECKOUT: 'false',
    PADDLE_TEST_CHECKOUT_KEY: 'secret',
  })

  assert.equal(disabled.priceIdsByPlan['test-monthly'], undefined)
  assert.equal(disabled.testCheckout.enabled, false)
  assert.equal(disabled.testCheckout.key, 'secret')

  const enabled = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_TEST_MONTHLY_PRICE_ID: 'pri_test_monthly',
    PADDLE_ENABLE_TEST_CHECKOUT: 'true',
    PADDLE_TEST_CHECKOUT_KEY: 'secret',
  })

  assert.equal(enabled.priceIdsByPlan['test-monthly'], 'pri_test_monthly')
  assert.equal(enabled.testCheckout.enabled, true)
  assert.equal(enabled.testCheckout.key, 'secret')
})

test('resolvePaddleConfig parses environment-specific legacy monthly and annual aliases', () => {
  const production = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_PRODUCTION_MONTHLY_LEGACY_PRICE_IDS: 'pri_old_monthly, pri_current_monthly ',
    PADDLE_PRODUCTION_ANNUAL_LEGACY_PRICE_IDS: ' pri_old_annual ',
    PADDLE_SANDBOX_MONTHLY_LEGACY_PRICE_IDS: 'pri_sb_monthly',
  })

  assert.deepEqual(production.legacyPriceIdsByPlan.monthly, ['pri_old_monthly', 'pri_current_monthly'])
  assert.deepEqual(production.legacyPriceIdsByPlan.annual, ['pri_old_annual'])

  const sandbox = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_PRODUCTION_MONTHLY_LEGACY_PRICE_IDS: 'pri_prod_monthly',
    PADDLE_SANDBOX_MONTHLY_LEGACY_PRICE_IDS: 'pri_sb_monthly',
    PADDLE_SANDBOX_ANNUAL_LEGACY_PRICE_IDS: 'pri_sb_annual_1,pri_sb_annual_2',
  })

  assert.deepEqual(sandbox.legacyPriceIdsByPlan.monthly, ['pri_sb_monthly'])
  assert.deepEqual(sandbox.legacyPriceIdsByPlan.annual, ['pri_sb_annual_1', 'pri_sb_annual_2'])
})
