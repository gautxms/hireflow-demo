import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

import resultsRouter, { shareTokenStore } from './results.js'
import { pool } from '../db/client.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/results', resultsRouter)
  return app
}

function authHeader(userId) {
  return { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
}

async function postShare() {
  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/results/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(42) },
      body: JSON.stringify({}),
    })
    return { response, payload: await response.json() }
  } finally {
    server.close()
  }
}

test('POST /api/results/share creates share token for active user', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  shareTokenStore.clear()
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql)
    if (/FROM users/.test(text)) return { rows: [{ id: 42, subscription_status: 'active' }] }
    if (/FROM parse_jobs/.test(text)) return { rows: [{ result: { candidates: [{ name: 'Ada', email: 'ada@example.com', score: 91 }] } }] }
    return { rows: [] }
  })

  const { response, payload } = await postShare()

  assert.equal(response.status, 201)
  assert.equal(typeof payload.shareToken, 'string')
  assert.equal(shareTokenStore.has(payload.shareToken), true)
  shareTokenStore.clear()
})

test('POST /api/results/share blocks inactive user without creating share token', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  shareTokenStore.clear()
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql)
    if (/FROM users/.test(text)) return { rows: [{ id: 42, subscription_status: 'past_due' }] }
    if (/FROM parse_jobs/.test(text)) throw new Error('candidate loading should not run')
    return { rows: [] }
  })

  const { response, payload } = await postShare()

  assert.equal(response.status, 403)
  assert.equal(payload.error, 'Subscription inactive')
  assert.equal(shareTokenStore.size, 0)
})
