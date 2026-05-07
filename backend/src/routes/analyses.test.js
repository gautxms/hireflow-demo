import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import analysesRouter from './analyses.js'
import { pool } from '../db/client.js'
import { parseQueue } from '../services/jobQueue.js'

function buildApp() {
  const app = express()
  app.use('/analyses', analysesRouter)
  return app
}

function authHeader(userId) {
  return { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
}

test('GET /analyses returns authenticated user scoped items with frontend fields', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const queryMock = t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 11, created_at: '2026-05-01T00:00:00.000Z', status: 'processing', job_description_title: 'Backend Engineer', total_count: '3', complete_count: '1', failed_count: '1', processing_count: '1' }] }
    }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses`, { headers: authHeader(7) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.equal(Array.isArray(payload.items), true)
  assert.equal(payload.items[0].id, '11')
  assert.equal(payload.items[0].jobDescriptionTitle, 'Backend Engineer')
  assert.equal(payload.items[0].summary.pending, 0)
  assert.equal(payload.items[0].fileCount, 3)
  assert.deepEqual(payload.items[0].filesPreview, [])
  assert.equal(queryMock.mock.callCount(), 3)
})



test('GET /analyses failedItems omits raw error text', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 12, created_at: '2026-05-01T00:00:00.000Z', status: 'failed', job_description_title: 'Backend Engineer', total_count: '1', complete_count: '0', failed_count: '1', processing_count: '0' }] }
    }
    if (sql.includes('COALESCE(NULLIF(pj.error_message')) {
      return { rows: [{ analysis_id: 12, filename: 'broken.pdf', status: 'failed', error: 'provider timeout: token abc123' }] }
    }
    if (sql.includes('COALESCE(pj.status, r.parse_status, \'queued\')')) {
      return { rows: [{ analysis_id: 12, filename: null, status: null }] }
    }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses`, { headers: authHeader(7) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.deepEqual(payload.items[0].failedItems, [{ filename: 'broken.pdf', status: 'failed' }])
  assert.deepEqual(payload.items[0].filesPreview, [{ name: 'Unknown file', status: 'queued' }])
  assert.equal(Object.prototype.hasOwnProperty.call(payload.items[0].failedItems[0], 'error'), false)
})
test('GET /analyses/:id returns owner-only detail payload', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(parseQueue, 'getJob', async () => null)
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 22, user_id: 9, status: 'queued', created_at: '2026-05-01T00:00:00.000Z', completed_at: null, error_summary: null, job_description_id: 4, job_description_title: 'Product Manager' }] }
    }
    if (sql.includes('FROM analysis_items ai')) {
      return { rows: [{ id: 101, resume_id: 'r-1', parse_job_id: 'p-1', created_at: '2026-05-01T00:00:10.000Z', filename: 'a.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:00.000Z', parse_result: { candidates: [{ name: 'Alice' }] } }] }
    }
    if (sql.includes('UPDATE analyses')) return { rows: [] }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/22`, { headers: authHeader(9) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.equal(payload.id, '22')
  assert.equal(Object.keys(payload).filter((key) => key === 'diagnostics').length, 1)
  assert.equal(payload.error, undefined)
  assert.equal(payload.jobDescriptionTitle, 'Product Manager')
  assert.equal(payload.items[0].id, '101')
  assert.deepEqual(payload.items[0].result, { candidates: [{ name: 'Alice' }] })
  assert.deepEqual(payload.items[0].normalizedCandidates, [{ name: 'Alice' }])
  assert.deepEqual(payload.diagnostics.resultExtraction, {
    totalItems: 1,
    parseableObjectCount: 1,
    candidateBearingItemCount: 1,
    malformedItemCount: 0,
  })
})

test('GET /analyses/:id normalizes historical parse result envelopes and malformed payloads', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(parseQueue, 'getJob', async () => null)
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 30, user_id: 9, status: 'queued', created_at: '2026-05-01T00:00:00.000Z', completed_at: null, error_summary: null, job_description_id: null, job_description_title: null }] }
    }
    if (sql.includes('FROM analysis_items ai')) {
      return {
        rows: [
          { id: 201, resume_id: 'r-1', parse_job_id: 'p-1', created_at: '2026-05-01T00:00:10.000Z', filename: 'a.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:00.000Z', parse_result: JSON.stringify({ output: JSON.stringify({ candidates: [{ name: 'Nested' }] }) }) },
          { id: 202, resume_id: 'r-2', parse_job_id: 'p-2', created_at: '2026-05-01T00:00:11.000Z', filename: 'b.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:01.000Z', parse_result: '{bad-json' },
        ],
      }
    }
    if (sql.includes('UPDATE analyses')) return { rows: [] }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/30`, { headers: authHeader(9) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.deepEqual(payload.items[0].normalizedCandidates, [{ name: 'Nested' }])
  assert.deepEqual(payload.items[1].normalizedCandidates, [])
  assert.deepEqual(payload.diagnostics.resultExtraction, {
    totalItems: 2,
    parseableObjectCount: 1,
    candidateBearingItemCount: 1,
    malformedItemCount: 1,
  })
})



test('GET /analyses/:id regression: does not reference undefined diagnostics variables', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(parseQueue, 'getJob', async () => null)
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 44, user_id: 9, status: 'queued', created_at: '2026-05-01T00:00:00.000Z', completed_at: null, error_summary: null, job_description_id: null, job_description_title: null }] }
    }
    if (sql.includes('FROM analysis_items ai')) {
      return { rows: [{ id: 301, resume_id: 'r-301', parse_job_id: 'p-301', created_at: '2026-05-01T00:00:10.000Z', filename: 'r.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:00.000Z', parse_result: JSON.stringify({ output: { candidates: [{ name: 'Regress' }] } }) }] }
    }
    if (sql.includes('UPDATE analyses')) return { rows: [] }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/44`, { headers: authHeader(9) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.deepEqual(payload.diagnostics, {
    resultExtraction: {
      totalItems: 1,
      parseableObjectCount: 1,
      candidateBearingItemCount: 1,
      malformedItemCount: 0,
    },
  })
})
test('GET /analyses/:id returns 404 for cross-user access', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 22, user_id: 999, status: 'queued', created_at: '2026-05-01T00:00:00.000Z' }] }
    }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/22`, { headers: authHeader(9) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Analysis not found')
})
