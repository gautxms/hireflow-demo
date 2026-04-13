import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../db/client.js'
import { requireActiveSubscription } from './subscriptionCheck.js'

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}

test('requireActiveSubscription allows active subscribers', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({ rows: [{ id: 1, subscription_status: 'active' }] })

  const req = { userId: 1 }
  const res = createRes()
  let nextCalled = false

  await requireActiveSubscription(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, true)
  assert.equal(req.subscriptionStatus, 'active')
  pool.query = originalQuery
})

test('requireActiveSubscription blocks inactive subscribers', async () => {
  const originalQuery = pool.query
  pool.query = async () => ({ rows: [{ id: 1, subscription_status: 'inactive' }] })

  const req = { userId: 1 }
  const res = createRes()

  await requireActiveSubscription(req, res, () => {})

  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'Subscription inactive')
  pool.query = originalQuery
})
