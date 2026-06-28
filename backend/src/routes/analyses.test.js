import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import analysesRouter from './analyses.js'
import { pool } from '../db/client.js'
import { parseQueue } from '../services/jobQueue.js'


after(async () => {
  await parseQueue.close().catch(() => {})
})

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
  assert.equal(queryMock.mock.callCount(), 4)
})




test('GET /analyses includes orphan upload_chunks as processing files', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 'a-1', created_at: '2026-05-01T00:00:00.000Z', status: 'pending', name: 'Fresh upload', job_description_title: 'Engineer', total_count: '0', complete_count: '0', failed_count: '0', processing_count: '0' }] }
    }
    if (sql.includes('upload_chunks uc')) {
      return { rows: [{ analysis_id: 'a-1', upload_id: 'u-1', filename: 'resume.pdf', mime_type: 'application/pdf', status: 'uploading', resume_id: null, parse_job_id: null, created_at: '2026-05-01T00:00:01.000Z', updated_at: new Date().toISOString() }] }
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
  assert.equal(payload.items[0].fileCount, 1)
  assert.equal(payload.items[0].liveStatus, 'processing')
  assert.equal(payload.items[0].summary.total, 1)
  assert.equal(payload.items[0].summary.processing, 1)
  assert.equal(payload.items[0].summary.pending, 0)
  assert.deepEqual(payload.items[0].filesPreview, [{
    name: 'resume.pdf',
    filename: 'resume.pdf',
    originalFilename: 'resume.pdf',
    fileExtension: null,
    mimeType: 'application/pdf',
    originalMimeType: 'application/pdf',
    status: 'processing',
    source: 'upload_chunk',
  }])
})

test('GET /analyses maps failed orphan upload_chunks as failed', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) return { rows: [{ id: 'a-fail', created_at: '2026-05-01T00:00:00.000Z', status: 'pending', total_count: '0', complete_count: '0', failed_count: '0', processing_count: '0' }] }
    if (sql.includes('upload_chunks uc')) return { rows: [{ analysis_id: 'a-fail', upload_id: 'u-fail', filename: 'bad.pdf', mime_type: 'application/pdf', status: 'rejected', created_at: '2026-05-01T00:00:01.000Z', updated_at: new Date().toISOString() }] }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses`, { headers: authHeader(7) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.equal(payload.items[0].liveStatus, 'failed')
  assert.equal(payload.items[0].summary.failed, 1)
  assert.equal(payload.items[0].filesPreview[0].status, 'failed')
})

test('GET /analyses/:id includes orphan upload_chunks placeholders and excludes candidates', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(parseQueue, 'getJob', async () => null)
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) return { rows: [{ id: 'a-2', user_id: 9, status: 'pending', name: 'Uploading', created_at: '2026-05-01T00:00:00.000Z', completed_at: null, error_summary: null, job_description_id: null, job_description_title: null }] }
    if (sql.includes('upload_chunks uc')) return { rows: [{ upload_id: 'u-2', filename: 'upload.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'completed', resume_id: null, parse_job_id: null, created_at: '2026-05-01T00:00:01.000Z', updated_at: new Date().toISOString() }] }
    if (sql.includes('FROM analysis_items ai')) return { rows: [] }
    if (sql.includes('UPDATE analyses')) return { rows: [] }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/a-2`, { headers: authHeader(9) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.equal(payload.liveStatus, 'processing')
  assert.equal(payload.summary.total, 1)
  assert.equal(payload.summary.processing, 1)
  assert.equal(payload.items[0].source, 'upload_chunk')
  assert.equal(payload.items[0].status, 'processing')
  assert.equal(payload.items[0].result, null)
  assert.deepEqual(payload.items[0].normalizedCandidates, [])
})

test('GET /analyses does not double count upload_chunks matching analysis_items', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) return { rows: [{ id: 'a-3', created_at: '2026-05-01T00:00:00.000Z', status: 'complete', total_count: '1', complete_count: '1', failed_count: '0', processing_count: '0' }] }
    if (sql.includes('COALESCE(pj.status, r.parse_status, \'queued\')')) return { rows: [{ analysis_id: 'a-3', filename: 'done.pdf', original_filename: 'done.pdf', status: 'complete' }] }
    if (sql.includes('upload_chunks uc')) return { rows: [] }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses`, { headers: authHeader(7) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.equal(payload.items[0].fileCount, 1)
  assert.equal(payload.items[0].summary.total, 1)
  assert.equal(payload.items[0].filesPreview.length, 1)
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
  assert.deepEqual(payload.items[0].failedItems, [{
    filename: 'broken.pdf',
    originalFilename: 'broken.pdf',
    fileExtension: null,
    mimeType: null,
    originalMimeType: null,
    status: 'failed',
  }])
  assert.deepEqual(payload.items[0].filesPreview, [{
    name: 'Unknown file',
    filename: null,
    originalFilename: null,
    fileExtension: null,
    mimeType: null,
    originalMimeType: null,
    status: 'queued',
  }])
  assert.equal(Object.prototype.hasOwnProperty.call(payload.items[0].failedItems[0], 'error'), false)
})
test('GET /analyses/:id returns owner-only detail payload', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(parseQueue, 'getJob', async () => null)
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM analyses a')) {
      return { rows: [{ id: 22, user_id: 9, status: 'queued', name: 'Business Analyst (4–6 Years Experience)', created_at: '2026-05-01T00:00:00.000Z', completed_at: null, error_summary: null, job_description_id: 4, job_description_title: 'Product Manager' }] }
    }
    if (sql.includes('FROM analysis_items ai')) {
      return { rows: [{ id: 101, resume_id: 'r-1', parse_job_id: 'p-1', created_at: '2026-05-01T00:00:10.000Z', filename: 'a.pdf', original_filename: 'a.pdf', file_extension: 'pdf', original_mime_type: 'application/pdf', file_type: 'application/pdf', resume_parse_status: 'complete', parse_error: null, parse_job_status: 'complete', progress: 100, error_message: null, parse_job_updated_at: '2026-05-01T00:01:00.000Z', parse_result: { candidates: [{ name: 'Alice' }] } }] }
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
  assert.equal(payload.name, 'Business Analyst (4–6 Years Experience)')
  assert.equal(Object.keys(payload).filter((key) => key === 'diagnostics').length, 1)
  assert.equal(payload.items[0].filename, 'a.pdf')
  assert.equal(payload.items[0].originalFilename, 'a.pdf')
  assert.equal(payload.items[0].fileExtension, 'pdf')
  assert.equal(payload.items[0].mimeType, 'application/pdf')
  assert.equal(payload.items[0].originalMimeType, 'application/pdf')
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


test('DELETE /analyses/:id deletes owner analysis transactionally', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const client = {
    released: false,
    query: t.mock.fn(async (sql) => {
      if (sql.includes('SELECT id FROM analyses WHERE id = $1 AND user_id = $2')) return { rowCount: 1, rows: [{ id: 'a-1' }] }
      return { rowCount: 1, rows: [] }
    }),
    release() { this.released = true },
  }
  t.mock.method(pool, 'connect', async () => client)

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/a-1`, { method: 'DELETE', headers: authHeader(7) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.resumePolicy, 'retained')
  assert.equal(client.query.mock.calls[0].arguments[0], 'BEGIN')
  assert.equal(client.query.mock.calls.at(-1).arguments[0], 'COMMIT')
  assert.equal(client.released, true)
})

test('DELETE /analyses/:id returns 403 for non-owner', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const client = {
    query: t.mock.fn(async (sql) => {
      if (sql.includes('SELECT id FROM analyses WHERE id = $1 AND user_id = $2')) return { rowCount: 0, rows: [] }
      if (sql.includes('SELECT id FROM analyses WHERE id = $1 LIMIT 1')) return { rowCount: 1, rows: [{ id: 'a-1' }] }
      return { rowCount: 0, rows: [] }
    }),
    release: t.mock.fn(() => {}),
  }
  t.mock.method(pool, 'connect', async () => client)

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/a-1`, { method: 'DELETE', headers: authHeader(8) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 403)
  assert.equal(payload.error, 'Forbidden')
})

test('DELETE /analyses/:id returns 404 when analysis is missing', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const client = {
    query: t.mock.fn(async (sql) => {
      if (sql.includes('SELECT id FROM analyses WHERE id = $1 AND user_id = $2')) return { rowCount: 0, rows: [] }
      if (sql.includes('SELECT id FROM analyses WHERE id = $1 LIMIT 1')) return { rowCount: 0, rows: [] }
      return { rowCount: 0, rows: [] }
    }),
    release: t.mock.fn(() => {}),
  }
  t.mock.method(pool, 'connect', async () => client)

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/missing`, { method: 'DELETE', headers: authHeader(8) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Analysis not found')
})

test('DELETE /analyses/:id attempts queued parse job cancellation and tolerates missing/completed jobs', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  const removed = []
  t.mock.method(parseQueue, 'getJob', async (jobId) => {
    if (jobId === 'p-waiting') {
      return {
        async getState() { return 'waiting' },
        async remove() { removed.push(jobId) },
      }
    }
    if (jobId === 'p-completed') {
      return {
        async getState() { return 'completed' },
        async remove() { removed.push(jobId) },
      }
    }
    return null
  })

  const client = {
    released: false,
    query: t.mock.fn(async (sql) => {
      if (sql.includes('SELECT id FROM analyses WHERE id = $1 AND user_id = $2')) return { rowCount: 1, rows: [{ id: 'a-1' }] }
      if (sql.includes('SELECT parse_job_id')) {
        return { rows: [{ parse_job_id: 'p-waiting' }, { parse_job_id: 'p-missing' }, { parse_job_id: 'p-completed' }] }
      }
      return { rowCount: 1, rows: [] }
    }),
    release() { this.released = true },
  }
  t.mock.method(pool, 'connect', async () => client)

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses/a-1`, { method: 'DELETE', headers: authHeader(7) })
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.deepEqual(removed, ['p-waiting'])
  assert.equal(client.released, true)
  assert.equal(
    client.query.mock.calls.some((call) => String(call.arguments[0]).includes("SET status = 'cancelled'")),
    true,
  )
  assert.equal(client.query.mock.calls.at(-1).arguments[0], 'COMMIT')
})

async function fetchAnalysesWithRows(t, { analysisRows, fileRows = [], uploadRows = [] }) {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('COALESCE(pj.status, r.parse_status, \'queued\')')) return { rows: fileRows }
    if (sql.includes('upload_chunks uc')) return { rows: uploadRows }
    if (sql.includes('FROM analyses a') && sql.includes('GROUP BY a.id')) return { rows: analysisRows }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/analyses`, { headers: authHeader(7) })
  const payload = await response.json()
  server.close()
  assert.equal(response.status, 200)
  return payload.items[0]
}

test('GET /analyses aggregation counts two upload_chunks with no analysis_items as two files', async (t) => {
  const item = await fetchAnalysesWithRows(t, {
    analysisRows: [{ id: 'a-transition', created_at: '2026-05-01T00:00:00.000Z', status: 'pending', total_count: '0', complete_count: '0', failed_count: '0', processing_count: '0' }],
    uploadRows: [
      { analysis_id: 'a-transition', upload_id: 'u-1', filename: 'one.pdf', mime_type: 'application/pdf', status: 'uploading', resume_id: null, parse_job_id: null, created_at: '2026-05-01T00:00:01.000Z', updated_at: new Date().toISOString() },
      { analysis_id: 'a-transition', upload_id: 'u-2', filename: 'two.pdf', mime_type: 'application/pdf', status: 'uploading', resume_id: null, parse_job_id: null, created_at: '2026-05-01T00:00:02.000Z', updated_at: new Date().toISOString() },
    ],
  })

  assert.equal(item.fileCount, 2)
  assert.equal(item.summary.processing, 2)
})

test('GET /analyses aggregation counts matching analysis_item and upload_chunk same resume once', async (t) => {
  const item = await fetchAnalysesWithRows(t, {
    analysisRows: [{ id: 'a-transition', created_at: '2026-05-01T00:00:00.000Z', status: 'processing', total_count: '1', complete_count: '0', failed_count: '0', processing_count: '1' }],
    fileRows: [{ analysis_id: 'a-transition', resume_id: 'r-1', parse_job_id: 'p-1', filename: 'one.pdf', original_filename: 'one.pdf', status: 'processing' }],
    uploadRows: [{ analysis_id: 'a-transition', upload_id: 'u-1', filename: 'one.pdf', mime_type: 'application/pdf', status: 'completed', resume_id: 'r-1', parse_job_id: null, created_at: '2026-05-01T00:00:01.000Z', updated_at: new Date().toISOString() }],
  })

  assert.equal(item.fileCount, 1)
  assert.equal(item.filesPreview.length, 1)
})

test('GET /analyses aggregation counts one analysis_item plus one distinct upload_chunk as two files', async (t) => {
  const item = await fetchAnalysesWithRows(t, {
    analysisRows: [{ id: 'a-transition', created_at: '2026-05-01T00:00:00.000Z', status: 'processing', total_count: '1', complete_count: '0', failed_count: '0', processing_count: '1' }],
    fileRows: [{ analysis_id: 'a-transition', resume_id: 'r-1', parse_job_id: 'p-1', filename: 'one.pdf', original_filename: 'one.pdf', status: 'processing' }],
    uploadRows: [{ analysis_id: 'a-transition', upload_id: 'u-2', filename: 'two.pdf', mime_type: 'application/pdf', status: 'uploading', resume_id: 'r-2', parse_job_id: null, created_at: '2026-05-01T00:00:02.000Z', updated_at: new Date().toISOString() }],
  })

  assert.equal(item.fileCount, 2)
  assert.equal(item.summary.processing, 2)
})

test('GET /analyses aggregation counts two matching analysis_items and upload_chunks as two files, not four', async (t) => {
  const item = await fetchAnalysesWithRows(t, {
    analysisRows: [{ id: 'a-transition', created_at: '2026-05-01T00:00:00.000Z', status: 'processing', total_count: '2', complete_count: '0', failed_count: '0', processing_count: '2' }],
    fileRows: [
      { analysis_id: 'a-transition', resume_id: 'r-1', parse_job_id: 'p-1', filename: 'one.pdf', original_filename: 'one.pdf', status: 'processing' },
      { analysis_id: 'a-transition', resume_id: 'r-2', parse_job_id: 'p-2', filename: 'two.pdf', original_filename: 'two.pdf', status: 'processing' },
    ],
    uploadRows: [
      { analysis_id: 'a-transition', upload_id: 'u-1', filename: 'one.pdf', mime_type: 'application/pdf', status: 'completed', resume_id: 'r-1', parse_job_id: 'p-1', created_at: '2026-05-01T00:00:01.000Z', updated_at: new Date().toISOString() },
      { analysis_id: 'a-transition', upload_id: 'u-2', filename: 'two.pdf', mime_type: 'application/pdf', status: 'completed', resume_id: 'r-2', parse_job_id: 'p-2', created_at: '2026-05-01T00:00:02.000Z', updated_at: new Date().toISOString() },
    ],
  })

  assert.equal(item.fileCount, 2)
  assert.equal(item.filesPreview.length, 2)
})

test('GET /analyses aggregation mixed completed and uploading upload_chunks do not inflate a two-file analysis to three', async (t) => {
  const item = await fetchAnalysesWithRows(t, {
    analysisRows: [{ id: 'a-transition', created_at: '2026-05-01T00:00:00.000Z', status: 'processing', total_count: '1', complete_count: '0', failed_count: '0', processing_count: '1' }],
    fileRows: [{ analysis_id: 'a-transition', resume_id: 'r-1', parse_job_id: null, filename: 'one.pdf', original_filename: 'one.pdf', status: 'processing' }],
    uploadRows: [
      { analysis_id: 'a-transition', upload_id: 'u-1', filename: 'one.pdf', mime_type: 'application/pdf', status: 'completed', resume_id: 'r-1', parse_job_id: null, created_at: '2026-05-01T00:00:01.000Z', updated_at: new Date().toISOString() },
      { analysis_id: 'a-transition', upload_id: 'u-2', filename: 'two.pdf', mime_type: 'application/pdf', status: 'uploading', resume_id: 'r-2', parse_job_id: null, created_at: '2026-05-01T00:00:02.000Z', updated_at: new Date().toISOString() },
    ],
  })

  assert.equal(item.fileCount, 2)
  assert.notEqual(item.fileCount, 3)
})
