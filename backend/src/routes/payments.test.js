import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import paymentsRouter from './payments.js'
import { requireAuth } from '../middleware/authMiddleware.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/payments', requireAuth, paymentsRouter)
  return app
}

function authHeader(userId = 123) {
  return { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
}

async function postCheckout({ body, headers } = {}) {
  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await fetch(`http://127.0.0.1:${port}/payments/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body || {}),
    })
    const payload = await response.json()
    return { response, payload }
  } finally {
    server.close()
  }
}

test('POST /payments/checkout requires authentication through existing mount', async () => {
  process.env.JWT_SECRET = 'test-secret'

  const { response, payload } = await postCheckout({
    body: { plan: 'monthly', priceId: 'pri_any' },
  })

  assert.equal(response.status, 401)
  assert.equal(payload.error, 'Unauthorized')
})

test('POST /payments/checkout is deprecated and does not return fake success', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const logs = []
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')))

  const { response, payload } = await postCheckout({
    headers: authHeader(),
    body: { plan: 'monthly', priceId: 'pri_arbitrary' },
  })

  assert.equal(response.status, 410)
  assert.deepEqual(payload, {
    error: 'Legacy checkout endpoint is deprecated. Use /api/paddle/checkout.',
  })
  assert.notDeepEqual(payload, { status: 'ok' })
  assert.equal(logs.some((entry) => entry.includes('pri_arbitrary') || entry.includes('monthly')), false)
})

test('POST /payments/checkout does not accept arbitrary priceId as fake success', async () => {
  process.env.JWT_SECRET = 'test-secret'

  const { response, payload } = await postCheckout({
    headers: authHeader(),
    body: { plan: 'annual', priceId: 'pri_user_supplied_fake' },
  })

  assert.equal(response.status, 410)
  assert.equal(payload.error, 'Legacy checkout endpoint is deprecated. Use /api/paddle/checkout.')
  assert.equal(payload.status, undefined)
})
