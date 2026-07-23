import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import process from 'node:process'
import { pool } from '../db/client.js'

process.env.JWT_SECRET = 'test-secret'
process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'test-bucket'
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1'

const { default: uploadChunksRouter } = await import('./uploadChunks.js')
const { parseQueue } = await import('../services/jobQueue.js')

after(async () => {
  await parseQueue.close()
  await pool.end()
})

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/uploads/chunks', uploadChunksRouter)
  return app
}

function authHeader(userId = 1) {
  return { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
}

async function requestJson(path, { method = 'POST', headers = {}, body } = {}) {
  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = await response.json()
    return { response, payload }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

function mockChunkUploadQueries(t, handler) {
  const queries = []
  const execute = async (sql, params) => {
    const text = String(sql)
    queries.push({ sql: text, params })
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] }
    if (text.includes('UPDATE upload_chunks') && text.includes('quota_recorded = true')) {
      return { rows: [{ upload_id: params[0] }] }
    }
    return handler(text, params, queries)
  }
  t.mock.method(pool, 'query', execute)
  t.mock.method(pool, 'connect', async () => ({ query: execute, release() {} }))
  return queries
}

test('POST /api/uploads/chunks/init requires authentication', async (t) => {
  const queries = mockChunkUploadQueries(t, () => ({ rows: [] }))

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    body: { filename: 'resume.pdf', fileSize: 1024, mimeType: 'application/pdf' },
  })

  assert.equal(response.status, 401)
  assert.equal(payload.error, 'Unauthorized')
  assert.equal(queries.length, 0)
})

test('POST /api/uploads/chunks/init blocks inactive subscriptions before quota/session work', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'cancelled' }] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    headers: authHeader(),
    body: { filename: 'resume.pdf', fileSize: 1024, mimeType: 'application/pdf' },
  })

  assert.equal(response.status, 403)
  assert.equal(payload.error, 'Subscription inactive')
  assert.equal(queries.length, 1)
})

test('POST /api/uploads/chunks/init enforces monthly quota before creating a session', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [{ upload_limit: 1, reset_usage: false }] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: 1 }] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    headers: authHeader(),
    body: { filename: 'resume.pdf', fileSize: 1024, mimeType: 'application/pdf' },
  })

  assert.equal(response.status, 429)
  assert.equal(payload.error, 'Upload limit reached')
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO upload_chunks')), false)
})

test('POST /api/uploads/chunks/preflight rejects a 795 plus 10 batch before any session starts', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('FROM usage_log')) return { rows: [{ usage_count: 795 }] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/preflight', {
    headers: authHeader(),
    body: { fileCount: 10, quotaIdempotencyKey: 'ten-file-batch' },
  })

  assert.equal(response.status, 429)
  assert.equal(payload.used, 795)
  assert.equal(payload.requested, 10)
  assert.equal(payload.remaining, 5)
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO upload_chunks')), false)
})

test('POST /api/uploads/chunks/preflight validates the whole-batch file count', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/preflight', {
    headers: authHeader(),
    body: { fileCount: 21 },
  })

  assert.equal(response.status, 400)
  assert.match(payload.error, /between 1 and 20/)
  assert.equal(queries.length, 1)
})

test('POST /api/uploads/chunks/init records exactly one usage row for a new session', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('SELECT COUNT(*)::INT AS usage_count')) return { rows: [{ usage_count: 0 }] }
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('INSERT INTO analyses')) return { rows: [{ id: '00000000-0000-4000-8000-000000000001' }] }
    if (sql.includes('FROM upload_chunks') && sql.includes("status = 'uploading'")) return { rows: [] }
    if (sql.includes('INSERT INTO upload_chunks')) return { rows: [] }
    if (sql.includes('INSERT INTO usage_log')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    headers: authHeader(),
    body: { filename: 'resume.pdf', fileSize: 1024, mimeType: 'application/pdf' },
  })

  assert.equal(response.status, 200)
  assert.equal(payload.resumed, false)
  const usageWrites = queries.filter(({ sql }) => sql.includes('INSERT INTO usage_log'))
  assert.equal(usageWrites.length, 1)
  assert.deepEqual(usageWrites[0].params.slice(0, 2), [1, '::ffff:127.0.0.1'])
})

test('POST /api/uploads/chunks/init passes clientChunkSize through to session creation', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('SELECT COUNT(*)::INT AS usage_count')) return { rows: [{ usage_count: 0 }] }
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('INSERT INTO analyses')) return { rows: [{ id: '00000000-0000-4000-8000-000000000601' }] }
    if (sql.includes('FROM upload_chunks') && sql.includes("status = 'uploading'")) return { rows: [] }
    if (sql.includes('INSERT INTO upload_chunks')) return { rows: [] }
    if (sql.includes('INSERT INTO usage_log')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    headers: authHeader(),
    body: {
      filename: 'large.pdf',
      fileSize: 25 * 1024 * 1024,
      mimeType: 'application/pdf',
      clientChunkSize: 4 * 1024 * 1024,
    },
  })

  assert.equal(response.status, 200)
  assert.equal(payload.totalChunks, 7)
  const insert = queries.find(({ sql }) => sql.includes('INSERT INTO upload_chunks'))
  assert.equal(insert.params[5], 7)
})

test('POST /api/uploads/chunks/init rejects files above the 25 MiB resume limit', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('SELECT COUNT(*)::INT AS usage_count')) return { rows: [{ usage_count: 0 }] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    headers: authHeader(),
    body: {
      filename: 'too-large.pdf',
      fileSize: (25 * 1024 * 1024) + 1,
      mimeType: 'application/pdf',
      clientChunkSize: 4 * 1024 * 1024,
    },
  })

  assert.equal(response.status, 400)
  assert.match(payload.error, /Files above 25MB are not supported yet/)
  assert.equal(queries.some(({ sql }) => sql.includes('FROM usage_overrides')), false)
  assert.equal(queries.some(({ sql }) => sql.includes('FROM usage_log')), false)
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO upload_chunks')), false)
})


test('POST /api/uploads/chunks/init rejects unsupported tiny clientChunkSize values', async (t) => {
  mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('SELECT COUNT(*)::INT AS usage_count')) return { rows: [{ usage_count: 0 }] }
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    headers: authHeader(),
    body: {
      filename: 'tiny-chunk.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      clientChunkSize: 1,
    },
  })

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'clientChunkSize must be 4MB or 5MB')
})

test('POST /api/uploads/chunks/init rejects clientChunkSize above backend chunk size limit', async (t) => {
  mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('SELECT COUNT(*)::INT AS usage_count')) return { rows: [{ usage_count: 0 }] }
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    headers: authHeader(),
    body: {
      filename: 'large.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      clientChunkSize: (5 * 1024 * 1024) + 1,
    },
  })

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'clientChunkSize must be 4MB or 5MB')
})

test('POST /api/uploads/chunks/init does not record usage for a resumed session', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM usage_overrides')) return { rows: [] }
    if (sql.includes('SELECT COUNT(*)::INT AS usage_count')) return { rows: [{ usage_count: 0 }] }
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('FROM analyses')) return { rows: [{ id: '00000000-0000-4000-8000-000000000002' }] }
    if (sql.includes('FROM upload_chunks') && sql.includes("status = 'uploading'")) {
      return {
        rows: [{
          upload_id: '00000000-0000-4000-8000-000000000003',
          total_chunks: 1,
          uploaded_chunks: [0],
        }],
      }
    }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/init', {
    headers: authHeader(),
    body: {
      filename: 'resume.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      analysisId: '00000000-0000-4000-8000-000000000002',
    },
  })

  assert.equal(response.status, 200)
  assert.equal(payload.resumed, true)
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO usage_log')), false)
})

test('POST /api/uploads/chunks/:uploadId/chunk blocks inactive subscriptions before storing chunks', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'cancelled' }] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/00000000-0000-4000-8000-000000000003/chunk', {
    headers: authHeader(),
    body: { chunkIndex: 0, totalChunks: 1 },
  })

  assert.equal(response.status, 403)
  assert.equal(payload.error, 'Subscription inactive')
  assert.equal(queries.length, 1)
})

test('POST /api/uploads/chunks/:uploadId/chunk preserves active subscription flow', async (t) => {
  mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/00000000-0000-4000-8000-000000000003/chunk', {
    headers: authHeader(),
    body: { chunkIndex: 0, totalChunks: 1 },
  })

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'chunk is required')
})

test('POST /api/uploads/chunks/:uploadId/complete blocks inactive subscriptions before completion', async (t) => {
  const queries = mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'cancelled' }] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/00000000-0000-4000-8000-000000000003/complete', {
    headers: authHeader(),
  })

  assert.equal(response.status, 403)
  assert.equal(payload.error, 'Subscription inactive')
  assert.equal(queries.length, 1)
})

test('POST /api/uploads/chunks/:uploadId/complete preserves active subscription flow', async (t) => {
  mockChunkUploadQueries(t, (sql) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, subscription_status: 'active' }] }
    if (sql.includes('FROM upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const { response, payload } = await requestJson('/api/uploads/chunks/00000000-0000-4000-8000-000000000003/complete', {
    headers: authHeader(),
  })

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Upload session not found')
})
