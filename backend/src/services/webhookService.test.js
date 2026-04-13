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

pool.query = async (queryText, params = []) => {
  const sql = String(queryText).trim()

  if (sql.startsWith('SELECT id, url, events, secret') && sql.includes('FROM integration_webhooks')) {
    return { rowCount: activeWebhooks.length, rows: activeWebhooks }
  }

  if (sql.startsWith('INSERT INTO integration_webhook_logs')) {
    return {
      rowCount: 1,
      rows: [{ id: 'log-1', status: 'failed', attempt: params[6], next_retry_at: null, created_at: new Date().toISOString() }],
    }
  }

  if (sql.startsWith('UPDATE integration_webhooks')) {
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

test('retryWebhookDelivery validates id and enforces retry max attempts', async () => {
  await assert.rejects(() => retryWebhookDelivery('not-a-uuid'), /invalid webhook log id/i)
  await assert.rejects(() => retryWebhookDelivery('11111111-1111-4111-8111-111111111111'), /maximum retry attempts exceeded/i)
})
