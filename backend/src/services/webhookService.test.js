import test from 'node:test'
import assert from 'node:assert/strict'

import { pool } from '../db/client.js'
import { retryWebhookDelivery, triggerWebhook } from './webhookService.js'

const originalQuery = pool.query.bind(pool)
const originalFetch = globalThis.fetch

const activeWebhooks = [
  { id: '11111111-1111-4111-8111-111111111111', url: 'https://example.com/hook-1', events: ['user.created'], secret: null },
  { id: '22222222-2222-4222-8222-222222222222', url: 'https://example.com/hook-2', events: ['user.created'], secret: null },
]

let deliveryLogInsertError = null
let lastTriggeredUpdateError = null

pool.query = async (queryText, params = []) => {
  const sql = String(queryText).trim()

  if (sql.startsWith('SELECT id, url, events, secret') && sql.includes('FROM integration_webhooks')) {
    return { rowCount: activeWebhooks.length, rows: activeWebhooks }
  }

  if (sql.startsWith('INSERT INTO integration_webhook_logs')) {
    if (deliveryLogInsertError) {
      const error = deliveryLogInsertError
      deliveryLogInsertError = null
      throw error
    }
    return {
      rowCount: 1,
      rows: [{ id: 'log-1', status: 'failed', attempt: params[6], next_retry_at: null, created_at: new Date().toISOString() }],
    }
  }

  if (sql.startsWith('UPDATE integration_webhooks')) {
    if (lastTriggeredUpdateError) {
      const error = lastTriggeredUpdateError
      lastTriggeredUpdateError = null
      throw error
    }
    return { rowCount: 1, rows: [] }
  }

  if (sql.startsWith('SELECT') && sql.includes('FROM integration_webhook_logs l') && sql.includes('WHERE l.id = $1')) {
    return {
      rowCount: 1,
      rows: [{
        id: 'log-abc',
        webhook_id: activeWebhooks[0].id,
        event_type: 'user.created',
        request_payload: { ok: true },
        attempt: 3,
        url: activeWebhooks[0].url,
        secret: null,
        is_active: true,
      }],
    }
  }

  throw new Error(`Unexpected SQL in webhookService.test: ${sql}`)
}

test.after(() => {
  pool.query = originalQuery
  globalThis.fetch = originalFetch
})

test('triggerWebhook is error-tolerant and continues after one endpoint fails', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) {
      throw new Error('network down')
    }

    return {
      ok: true,
      status: 200,
      text: async () => 'ok',
    }
  }

  const result = await triggerWebhook('user.created', { id: 9 })
  assert.equal(calls, 2)
  assert.equal(result.length, 2)
})

test('triggerWebhook reports a missing durable delivery log when required by its caller', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    text: async () => 'temporarily unavailable',
  })
  deliveryLogInsertError = new Error('delivery log unavailable')

  await assert.rejects(
    () => triggerWebhook('user.created', { id: 10 }, { requireDurableLog: true }),
    /deliver(?:y|ies).*durably recorded/i,
  )
})

test('triggerWebhook does not redeliver when only last-triggered metadata fails after durable logging', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    text: async () => 'temporarily unavailable',
  })
  lastTriggeredUpdateError = new Error('last-triggered metadata unavailable')

  const result = await triggerWebhook(
    'user.created',
    { id: 11 },
    { requireDurableLog: true },
  )

  assert.equal(result.length, 2)
})

test('retryWebhookDelivery validates id and enforces retry max attempts', async () => {
  await assert.rejects(() => retryWebhookDelivery('not-a-uuid'), /invalid webhook log id/i)
  await assert.rejects(() => retryWebhookDelivery('11111111-1111-4111-8111-111111111111'), /maximum retry attempts exceeded/i)
})
