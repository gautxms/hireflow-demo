import test from 'node:test'
import assert from 'node:assert/strict'
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

async function invokeRoute(router, path, req) {
  const layer = router.stack.find((entry) => entry.route?.path === path)
  assert.ok(layer, `${path} route exists`)
  const res = createRes()
  await layer.route.stack[0].handle(req, res, () => {})
  return res
}

function blockPaymentMutations(t) {
  t.mock.method(pool, 'query', async () => assert.fail('disabled payment retry must not query the database'))
  t.mock.method(globalThis, 'fetch', async () => assert.fail('disabled payment retry must not call Paddle'))
}

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
