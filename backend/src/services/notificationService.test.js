import process from 'node:process'
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

import { pool } from '../db/client.js'
import notificationsRouter from '../routes/notifications.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const originalQuery = pool.query.bind(pool)
const deliveries = new Map()

pool.query = async (queryText, params = []) => {
  const sql = String(queryText).trim()

  if (sql.startsWith('SELECT id, status, idempotency_key, created_at') && sql.includes('FROM notification_deliveries')) {
    const [idempotencyKey] = params
    const entry = deliveries.get(idempotencyKey)
    return { rowCount: entry ? 1 : 0, rows: entry ? [entry] : [] }
  }

  if (sql.startsWith('INSERT INTO notification_deliveries')) {
    const [userId, type, recipientEmail, idempotencyKey, status, errorMessage, metadataRaw] = params
    const row = {
      id: `id-${deliveries.size + 1}`,
      user_id: userId,
      notification_type: type,
      recipient_email: recipientEmail,
      idempotency_key: idempotencyKey,
      status,
      error_message: errorMessage,
      metadata: JSON.parse(metadataRaw),
      created_at: new Date().toISOString(),
    }
    deliveries.set(idempotencyKey, row)
    return { rowCount: 1, rows: [row] }
  }

  if (sql.startsWith('WITH scoped AS')) {
    const [userId, pageSize, offset] = params
    const selected = [...deliveries.values()].filter((item) => item.user_id === userId).slice(offset, offset + pageSize)
    const rows = selected.map((item) => ({ ...item, total_count: selected.length }))
    return { rowCount: rows.length, rows }
  }

  throw new Error(`Unexpected SQL in notificationService.test: ${sql}`)
}

test.after(() => {
  pool.query = originalQuery
})

function buildServer() {
  const app = express()
  app.use(express.json())
  app.use('/api/notifications', requireAuth, notificationsRouter)
  const server = app.listen(0)
  const address = server.address()
  const url = `http://127.0.0.1:${address.port}`
  return { server, url }
}

test('notification endpoints enforce auth and payload validation', async () => {
  const { server, url } = buildServer()

  try {
    const unauth = await fetch(`${url}/api/notifications/transactional`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'demo.request.submitted', recipientEmail: 'valid@example.com' }),
    })
    assert.equal(unauth.status, 401)

    const token = jwt.sign({ userId: 123 }, process.env.JWT_SECRET)
    const badPayload = await fetch(`${url}/api/notifications/transactional`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type: 'nope', recipientEmail: 'not-an-email' }),
    })

    assert.equal(badPayload.status, 400)
    const body = await badPayload.json()
    assert.match(body.error, /unsupported/i)
  } finally {
    server.close()
  }
})

test('transactional notification endpoint deduplicates by idempotency key', async () => {
  deliveries.clear()
  const { server, url } = buildServer()

  try {
    const token = jwt.sign({ userId: 44 }, process.env.JWT_SECRET)
    const payload = {
      type: 'demo.request.submitted',
      recipientEmail: 'person@example.com',
      payload: { requesterName: 'Sam', company: 'Acme', message: 'Need a demo' },
      idempotencyKey: 'demo-req-123',
    }

    const first = await fetch(`${url}/api/notifications/transactional`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })

    assert.equal([201, 502].includes(first.status), true)

    const second = await fetch(`${url}/api/notifications/transactional`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })

    assert.equal(second.status, 200)
    const secondBody = await second.json()
    assert.equal(secondBody.duplicate, true)
    assert.equal(secondBody.idempotencyKey, 'demo-req-123')
  } finally {
    server.close()
  }
})
