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
