import test from 'node:test'
import assert from 'node:assert/strict'

import { registerParseResumeJobProcessor } from './parseResumeJob.js'
import { parseQueue } from '../services/jobQueue.js'
import { pool } from '../db/client.js'

function buildEncryptedPdfBase64() {
  const fileBuffer = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Encrypt 2 0 R >>\n%%EOF', 'latin1')
  return fileBuffer.toString('base64')
}

test('preflight-unrecoverable files short-circuit before scoring and avoid scoring-stage token writes', async (t) => {
  let processor = null
  t.mock.method(parseQueue, 'process', (handler) => { processor = handler })
  const dbCalls = []
  t.mock.method(pool, 'query', async (sql, params) => {
    dbCalls.push(String(sql))
    if (String(sql).includes('UPDATE resumes')) return { rowCount: 1, rows: [] }
    return { rowCount: 0, rows: [] }
  })


  registerParseResumeJobProcessor()
  assert.equal(typeof processor, 'function')

  const setProgressCalls = []
  const fakeJob = {
    id: 'job-preflight-1',
    timestamp: Date.now(),
    attemptsMade: 0,
    opts: { attempts: 1 },
    data: {
      resumeId: 'resume-1',
      userId: 9,
      filename: 'locked.pdf',
      mimeType: 'application/pdf',
      fileSize: 1234,
      fileBufferBase64: buildEncryptedPdfBase64(),
    },
    progress(value) {
      if (typeof value === 'number') setProgressCalls.push(value)
      return setProgressCalls.at(-1) ?? 0
    },
  }

  const parseResult = await processor(fakeJob)
  assert.equal(parseResult.parseOutcome, 'failed')
  assert.equal(parseResult.failureCategory, 'encrypted_or_password_protected_pdf')
  assert.equal(parseResult.parseMeta.scoringStatus, 'skipped_preflight_unrecoverable')


  const tokenUsageWrites = dbCalls.filter((sql) => sql.includes('resume_analysis_token_usage'))
  assert.equal(tokenUsageWrites.length, 0)

  const resumeUpdateWrites = dbCalls.filter((sql) => sql.includes('UPDATE resumes'))
  assert.equal(resumeUpdateWrites.length, 1)
})
