import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pool } from '../../db/client.js'
import adminPaymentsRouter from './payments.js'
import adminSubscriptionsRouter from './subscriptions.js'
import adminHealthRouter from './health.js'

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
  }
}

async function invokeRoute(router, path, req, method = 'post') {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method])
  assert.ok(layer, `${path} route exists`)
  const res = createRes()
  await layer.route.stack[0].handle(req, res, () => {})
  return res
}

function blockPaymentMutations(t) {
  t.mock.method(pool, 'query', async () => assert.fail('disabled payment retry must not query the database'))
  t.mock.method(globalThis, 'fetch', async () => assert.fail('disabled payment retry must not call Paddle'))
}

function assertUnavailableRefundResponse(res) {
  assert.equal(res.statusCode, 410)
  assert.equal(res.payload.code, 'ADMIN_REFUNDS_UNAVAILABLE')
  assert.match(res.payload.error, /not available through HireFlow/i)
  assert.doesNotMatch(res.payload.error, /succeeded|completed|pending|processed/i)
}

test('admin subscription route contains no reachable provider refund or local success mutation', () => {
  const source = readFileSync(new URL('./subscriptions.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /\/adjustments|action:\s*['"]refund['"]/)
  assert.doesNotMatch(source, /INSERT INTO admin_refund_audit/)
  assert.doesNotMatch(source, /UPDATE billing_invoices[\s\S]*SET status[\s\S]*refunded/)
})

test('admin refund PATCH is unavailable without database or Paddle access', async (t) => {
  blockPaymentMutations(t)

  const res = await invokeRoute(adminSubscriptionsRouter, '/:subscriptionId/refund', {
    params: { subscriptionId: 'sub_production_admin' },
    body: { reason: 'other', adminId: 'admin-1' },
  }, 'patch')

  assertUnavailableRefundResponse(res)
})

test('admin refund POST is unavailable in Sandbox without database or Paddle access', async (t) => {
  blockPaymentMutations(t)

  const res = await invokeRoute(adminSubscriptionsRouter, '/:subscriptionId/refund', {
    params: { subscriptionId: 'sub_sandbox_admin' },
    body: { reason: 'cancellation', adminId: 'admin-1' },
  })

  assertUnavailableRefundResponse(res)
})

test('admin payment retry is rejected without database or Paddle access', async (t) => {
  blockPaymentMutations(t)

  const res = await invokeRoute(adminPaymentsRouter, '/:transactionId/retry', {
    params: { transactionId: 'txn_sandbox_admin' },
  })

  assert.equal(res.statusCode, 410)
  assert.equal(res.payload.code, 'PADDLE_MANAGED_PAYMENT_RECOVERY')
})

test('admin subscription retry is rejected without database or Paddle access', async (t) => {
  blockPaymentMutations(t)

  const res = await invokeRoute(adminSubscriptionsRouter, '/:subscriptionId/retry-payment', {
    params: { subscriptionId: 'sub_sandbox_admin' },
  })

  assert.equal(res.statusCode, 410)
  assert.equal(res.payload.code, 'PADDLE_MANAGED_PAYMENT_RECOVERY')
})

test('admin health payment retry is rejected without database or Paddle access', async (t) => {
  blockPaymentMutations(t)

  const res = await invokeRoute(adminHealthRouter, '/jobs/:id/retry', {
    params: { id: 'attempt_sandbox_admin' },
  })

  assert.equal(res.statusCode, 410)
  assert.equal(res.payload.code, 'PADDLE_MANAGED_PAYMENT_RECOVERY')
})
