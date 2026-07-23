import test from 'node:test'
import assert from 'node:assert/strict'
import { syncCompletedCheckout } from './paddleSubscriptionSync.js'

test('syncCompletedCheckout sends the authenticated Paddle transaction reference', async () => {
  const calls = []
  const result = await syncCompletedCheckout({
    apiBase: 'https://api.example.test/api',
    token: 'token-123',
    transactionId: 'txn_123',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return {
        ok: true,
        status: 200,
        json: async () => ({ synced: true, status: 'active', plan: 'monthly' }),
      }
    },
  })

  assert.equal(result.synced, true)
  assert.match(calls[0].url, /\/paddle\/checkout\/sync$/)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-123')
  assert.deepEqual(JSON.parse(calls[0].options.body), { transactionId: 'txn_123' })
})

test('syncCompletedCheckout can request automatic repair for a final-cancellation account', async () => {
  let requestBody
  const result = await syncCompletedCheckout({
    apiBase: 'https://api.example.test/api',
    token: 'token-123',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return {
        ok: true,
        status: 202,
        json: async () => ({ synced: false, reason: 'transaction_pending' }),
      }
    },
  })

  assert.deepEqual(requestBody, {})
  assert.equal(result.reason, 'transaction_pending')
})

test('syncCompletedCheckout does not claim activation when reconciliation is rejected', async () => {
  const result = await syncCompletedCheckout({
    apiBase: 'https://api.example.test/api',
    token: 'token-123',
    transactionId: 'txn_conflict',
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ synced: false, reason: 'subscription_state_changed' }),
    }),
  })

  assert.equal(result.synced, false)
  assert.equal(result.reason, 'subscription_state_changed')
})
