import test from 'node:test'
import assert from 'node:assert/strict'
import { logCheckoutOriginStatus, resolveCanonicalCheckoutOrigin } from './checkoutOrigin.js'

test('production checkout requires an explicit canonical HTTPS application origin', () => {
  const env = { NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://railway-backend.example.test' }
  assert.deepEqual(resolveCanonicalCheckoutOrigin(env), {
    origin: null, reason: 'app_origin_missing', configured: false, environment: 'production',
  })

  for (const candidate of [
    'not a URL', 'hireflow.dev', 'http://hireflow.dev', 'https://hireflow.dev/path',
    'https://hireflow.dev?query=1', 'https://hireflow.dev/#fragment',
    'https://user:password@hireflow.dev', 'https://@hireflow.dev', 'https://hireflow.dev//',
    'https://hireflow.dev\\evil.example', 'https://hireflow.dev:bad',
  ]) {
    assert.equal(resolveCanonicalCheckoutOrigin({ ...env, APP_ORIGIN: candidate }).origin, null, candidate)
  }

  assert.deepEqual(resolveCanonicalCheckoutOrigin({ ...env, APP_ORIGIN: 'https://hireflow.dev/' }), {
    origin: 'https://hireflow.dev', reason: null, configured: true, environment: 'production',
  })
})

test('local development uses its documented frontend origin, never the request host', () => {
  assert.equal(resolveCanonicalCheckoutOrigin({ NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173/' }).origin, 'http://localhost:5173')
  assert.equal(resolveCanonicalCheckoutOrigin({ NODE_ENV: 'development' }).origin, null)
  assert.equal(resolveCanonicalCheckoutOrigin({ NODE_ENV: 'development', APP_ORIGIN: 'bad', FRONTEND_ORIGIN: 'http://localhost:5173' }).origin, null)
})

test('startup diagnostic reports validity without exposing the configured value', (t) => {
  const logs = []
  t.mock.method(console, 'info', (...args) => logs.push(args))
  logCheckoutOriginStatus({ NODE_ENV: 'production', APP_ORIGIN: 'https://hireflow.dev' })
  assert.deepEqual(logs[0][1], {
    environment: 'production', appOriginConfigured: true, valid: true, reason: null,
  })
  assert.equal(JSON.stringify(logs).includes('hireflow.dev'), false)
})
