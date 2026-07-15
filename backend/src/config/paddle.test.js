import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolvePaddleConfig,
  resolvePaddleConfigForUser,
  resolvePaddleEnvironmentForUser,
} from './paddle.js'

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
    PADDLE_SANDBOX_MONTHLY_NO_TRIAL_PRICE_ID: 'pri_sb_m_paid',
    PADDLE_SANDBOX_ANNUAL_NO_TRIAL_PRICE_ID: 'pri_sb_a_paid',
  })

  assert.equal(cfg.environment, 'sandbox')
  assert.equal(cfg.apiKey, 'sb_key')
  assert.equal(cfg.clientToken, 'sb_token')
  assert.equal(cfg.priceIdsByPlan.monthly, 'pri_sb_m')
  assert.equal(cfg.priceIdsByPlan.annual, 'pri_sb_a')
  assert.deepEqual(cfg.noTrialPriceIdsByPlan, { monthly: 'pri_sb_m_paid', annual: 'pri_sb_a_paid' })
})

test('resolvePaddleConfig keeps production values in production', () => {
  const cfg = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_API_KEY: 'live_key',
    PADDLE_CLIENT_TOKEN: 'live_token',
    PADDLE_MONTHLY_PRICE_ID: 'pri_live_m',
    PADDLE_ANNUAL_PRICE_ID: 'pri_live_a',
    PADDLE_MONTHLY_NO_TRIAL_PRICE_ID: 'pri_live_m_paid',
    PADDLE_ANNUAL_NO_TRIAL_PRICE_ID: 'pri_live_a_paid',
    PADDLE_SANDBOX_API_KEY: 'sb_key',
  })

  assert.equal(cfg.environment, 'production')
  assert.equal(cfg.apiKey, 'live_key')
  assert.equal(cfg.clientToken, 'live_token')
  assert.equal(cfg.priceIdsByPlan.monthly, 'pri_live_m')
  assert.equal(cfg.priceIdsByPlan.annual, 'pri_live_a')
  assert.deepEqual(cfg.noTrialPriceIdsByPlan, { monthly: 'pri_live_m_paid', annual: 'pri_live_a_paid' })
})

test('resolvePaddleConfig accepts an explicit sandbox override while the deployment default remains production', () => {
  const cfg = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_API_BASE_URL: 'https://api.paddle.com',
    PADDLE_API_KEY: 'live_key',
    PADDLE_SANDBOX_API_KEY: 'sb_key',
    PADDLE_SANDBOX_CLIENT_TOKEN: 'sb_token',
    PADDLE_SANDBOX_MONTHLY_PRICE_ID: 'pri_sb_m',
    PADDLE_SANDBOX_ANNUAL_PRICE_ID: 'pri_sb_a',
  }, 'sandbox')

  assert.equal(cfg.environment, 'sandbox')
  assert.equal(cfg.apiBaseUrl, 'https://sandbox-api.paddle.com')
  assert.equal(cfg.apiKey, 'sb_key')
  assert.equal(cfg.clientToken, 'sb_token')
  assert.equal(cfg.priceIdsByPlan.monthly, 'pri_sb_m')
  assert.equal(cfg.priceIdsByPlan.annual, 'pri_sb_a')
})

test('resolvePaddleConfigForUser selects sandbox only for an explicitly sandbox user', () => {
  const env = {
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_PRODUCTION_API_KEY: 'live_key',
    PADDLE_SANDBOX_API_KEY: 'sb_key',
  }

  assert.equal(resolvePaddleEnvironmentForUser({ paddle_environment: 'sandbox' }, env), 'sandbox')
  assert.equal(resolvePaddleEnvironmentForUser({ paddle_environment: 'production' }, env), 'production')
  assert.equal(resolvePaddleEnvironmentForUser({ paddle_environment: null }, env), 'production')
  assert.equal(resolvePaddleConfigForUser({ paddle_environment: 'sandbox' }, env).apiKey, 'sb_key')
  assert.equal(resolvePaddleConfigForUser({ paddle_environment: 'production' }, env).apiKey, 'live_key')
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


test('resolvePaddleConfig exposes hidden test upgrade configuration independently of test checkout', () => {
  const cfg = resolvePaddleConfig({
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_ENABLE_TEST_CHECKOUT: 'true',
    PADDLE_TEST_CHECKOUT_KEY: 'checkout-secret',
    PADDLE_TEST_MONTHLY_PRICE_ID: 'pri_test_monthly',
    PADDLE_ENABLE_TEST_UPGRADE: 'true',
    PADDLE_TEST_UPGRADE_KEY: 'upgrade-secret',
    PADDLE_TEST_ANNUAL_PRICE_ID: 'pri_test_annual',
  })

  assert.equal(cfg.testCheckout.enabled, true)
  assert.equal(cfg.testCheckout.key, 'checkout-secret')
  assert.equal(cfg.priceIdsByPlan['test-monthly'], 'pri_test_monthly')
  assert.deepEqual(cfg.testUpgrade, {
    enabled: true,
    key: 'upgrade-secret',
    annualPriceId: 'pri_test_annual',
    monthlyPriceId: 'pri_test_monthly',
  })
})
