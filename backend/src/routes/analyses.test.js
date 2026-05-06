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
  assert.equal(queryMock.mock.callCount(), 2)
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
  assert.equal(payload.jobDescriptionTitle, 'Product Manager')
  assert.equal(payload.items[0].id, '101')
  assert.deepEqual(payload.items[0].result, { candidates: [{ name: 'Alice' }] })
  assert.deepEqual(payload.diagnostics.results, { valid: 1, invalid: 0, skipped: 0 })
})

test('GET /analyses/:id normalizes mixed parse result fixtures and skips malformed items', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(parseQueue, 'getJob', async () => null)
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 44, user_id: 9, status: 'queued', created_at: '2026-05-01T00:00:00.000Z', completed_at: null, error_summary: null, job_description_id: 8, job_description_title: 'Platform Engineer' }] }
    }
    if (sql.includes('FROM analysis_items ai')) {
      return {
        rows: [
          { id: 1, resume_id: 'r-1', parse_job_id: 'p-1', created_at: '2026-05-01T00:00:10.000Z', filename: 'a.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:00.000Z', parse_result: { candidates: [{ name: 'Direct Candidate' }] } },
          { id: 2, resume_id: 'r-2', parse_job_id: 'p-2', created_at: '2026-05-01T00:00:11.000Z', filename: 'b.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:01.000Z', parse_result: { output: { candidates: [{ name: 'Wrapped Candidate' }] } } },
          { id: 3, resume_id: 'r-3', parse_job_id: 'p-3', created_at: '2026-05-01T00:00:12.000Z', filename: 'c.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:02.000Z', parse_result: '{"candidates":[{"name":"String Candidate"}]}' },
          { id: 4, resume_id: 'r-4', parse_job_id: 'p-4', created_at: '2026-05-01T00:00:13.000Z', filename: 'd.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:03.000Z', parse_result: '{bad json' },
          { id: 5, resume_id: 'r-5', parse_job_id: 'p-5', created_at: '2026-05-01T00:00:14.000Z', filename: 'e.pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:04.000Z', parse_result: { output: { notCandidates: [] } } },
        ],
      }
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
  assert.equal(payload.items.length, 5)
  assert.deepEqual(payload.items[0].result, { candidates: [{ name: 'Direct Candidate' }] })
  assert.deepEqual(payload.items[1].result, { candidates: [{ name: 'Wrapped Candidate' }] })
  assert.deepEqual(payload.items[2].result, { candidates: [{ name: 'String Candidate' }] })
  assert.equal(payload.items[3].result, null)
  assert.equal(payload.items[4].result, null)
  assert.deepEqual(payload.diagnostics.results, { valid: 3, invalid: 2, skipped: 2 })
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
