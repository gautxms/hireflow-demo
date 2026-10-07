import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import previewRouter from './jobDescriptionPreview.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { pool } from '../db/client.js'

after(async () => {
  await pool.end().catch(() => {})
})

function createApp() {
  const app = express()
  app.use('/job-descriptions', requireAuth, previewRouter)
  return app
}

async function postPreview(app, { authenticated = true, file = null } = {}) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
  const server = app.listen(0)
  try {
    const form = new FormData()
    if (file) form.append('jdFile', new Blob([file.content], { type: file.type }), file.name)
    const response = await fetch(`http://127.0.0.1:${server.address().port}/job-descriptions/preview`, {
      method: 'POST',
      headers: authenticated ? { authorization: `Bearer ${jwt.sign({ userId: 42 }, process.env.JWT_SECRET)}` } : {},
      body: form,
    })
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('preview requires authentication before querying subscription', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('Unauthenticated request reached DB') })
  const response = await postPreview(createApp(), { authenticated: false })
  assert.equal(response.status, 401)
})

test('read-only subscribers cannot invoke preview', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    assert.match(String(sql), /FROM users/)
    return { rows: [{ id: 42, subscription_status: 'past_due' }] }
  })
  const response = await postPreview(createApp())
  assert.equal(response.status, 403)
  assert.equal(response.body.error, 'Subscription inactive')
})

test('active subscribers get validation errors without creating a job or calling AI', async (t) => {
  let queries = 0
  t.mock.method(pool, 'query', async (sql) => {
    assert.match(String(sql), /FROM users/)
    queries += 1
    return { rows: [{ id: 42, subscription_status: 'active' }] }
  })
  const app = createApp()
  const missing = await postPreview(app)
  assert.equal(missing.status, 400)
  assert.equal(missing.body.code, 'JD_FILE_REQUIRED')
  assert.equal(missing.cacheControl, 'no-store')

  const invalid = await postPreview(app, { file: { name: 'role.pdf', type: 'application/pdf', content: 'invalid' } })
  assert.equal(invalid.status, 422)
  assert.equal(invalid.body.code, 'JD_INVALID_FILE')
  assert.equal(queries, 2)
})
