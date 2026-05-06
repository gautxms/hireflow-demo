import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import uploadsRouter from './uploads.js'
import { pool } from '../../db/client.js'

function buildApp() {
  const app = express()
  app.use('/admin/uploads', uploadsRouter)
  return app
}

test('GET /admin/uploads preserves parseError in admin payload', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('ALTER TABLE resumes')) return { rows: [] }
    if (sql.includes('CREATE TABLE IF NOT EXISTS resume_analysis_token_usage')) return { rows: [] }
    if (sql.includes('SELECT COUNT(*)::INT AS count')) return { rows: [{ count: 1 }] }
    if (sql.includes('FROM resumes r')) {
      return {
        rows: [{
          id: 'upload-1',
          user_id: 12,
          user_email: 'admin@example.com',
          filename: 'broken.pdf',
          raw_text: '',
          file_size: 123,
          file_type: 'application/pdf',
          parse_status: 'failed',
          parse_result: null,
          parse_error: 'Unable to read PDF xref table',
          parse_duration_ms: 1200,
          created_at: '2026-05-01T01:00:00.000Z',
          updated_at: '2026-05-01T01:02:00.000Z',
          usage_available: false,
          unavailable_reason: 'parser_failed',
          token_provider: null,
          token_model: null,
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          estimated_cost_usd: null,
          token_captured_at: null,
        }],
      }
    }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/admin/uploads`)
  const payload = await response.json()
  server.close()

  assert.equal(response.status, 200)
  assert.equal(payload.uploads.length, 1)
  assert.equal(payload.uploads[0].parseError, 'Unable to read PDF xref table')
})

test('GET /admin/uploads/export keeps parse_error column and value', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('ALTER TABLE resumes')) return { rows: [] }
    if (sql.includes('CREATE TABLE IF NOT EXISTS resume_analysis_token_usage')) return { rows: [] }
    if (sql.includes('FROM resumes r')) {
      return {
        rows: [{
          id: 'upload-2',
          filename: 'resume.docx',
          user_id: 7,
          created_at: '2026-05-02T12:00:00.000Z',
          file_size: 456,
          file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          parse_status: 'failed',
          parse_duration_ms: 900,
          parse_error: 'DOCX archive missing word/document.xml',
          token_provider: 'openai',
          token_model: 'gpt-5-mini',
          usage_available: true,
          unavailable_reason: null,
          input_tokens: 111,
          output_tokens: 222,
          total_tokens: 333,
          estimated_cost_usd: 0.0123,
        }],
      }
    }
    return { rows: [] }
  })

  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/admin/uploads/export`)
  const csv = await response.text()
  server.close()

  assert.equal(response.status, 200)
  const [header, row] = csv.trim().split('\n')
  assert.match(header, /parse_error/)
  assert.match(row, /DOCX archive missing word\/document.xml/)
})
