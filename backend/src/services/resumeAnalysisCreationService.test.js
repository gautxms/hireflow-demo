import test from 'node:test'
import assert from 'node:assert/strict'
import { createResumeAnalysis, ResumeAnalysisCreationError } from './resumeAnalysisCreationService.js'

function resumeFile(name = 'candidate.pdf') {
  return {
    originalname: name,
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 candidate resume'),
  }
}

test('confirmed analysis creation enforces job ownership and queues scanned resumes', async () => {
  const queries = []
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params })
      if (String(sql).includes('FROM job_descriptions')) {
        return { rows: [{ id: '00000000-0000-4000-8000-000000000201' }] }
      }
      if (String(sql).includes('INSERT INTO analyses')) {
        return { rows: [{ id: '00000000-0000-4000-8000-000000000202' }] }
      }
      if (String(sql).includes('INSERT INTO resumes')) {
        return { rows: [{ id: '00000000-0000-4000-8000-000000000203' }] }
      }
      return { rows: [] }
    },
  }
  const released = []
  const result = await createResumeAnalysis({
    db,
    userId: 42,
    analysisName: 'Backend shortlist',
    jobDescriptionId: '00000000-0000-4000-8000-000000000201',
    files: [resumeFile()],
  }, {
    prepareQuota: async ({ requestedUploads }) => {
      assert.equal(requestedUploads, 1)
      return { reservationId: '00000000-0000-4000-8000-000000000204' }
    },
    scanFile: async () => ({ ok: true, status: 'clean', sha256: 'a'.repeat(64) }),
    allocateQuota: async ({ resumeId }) => {
      assert.equal(resumeId, '00000000-0000-4000-8000-000000000203')
      return { allocation: { id: '00000000-0000-4000-8000-000000000205' } }
    },
    enqueue: async ({ analysisId, jobDescriptionId, quotaAllocationId }) => {
      assert.equal(analysisId, '00000000-0000-4000-8000-000000000202')
      assert.equal(jobDescriptionId, '00000000-0000-4000-8000-000000000201')
      assert.equal(quotaAllocationId, '00000000-0000-4000-8000-000000000205')
      return { id: 'parse-job-1' }
    },
    releaseReservation: async (input) => { released.push(input) },
  })

  assert.equal(result.status, 'processing')
  assert.equal(result.queued, 1)
  assert.equal(result.failed, 0)
  assert.equal(result.files[0].name, 'candidate.pdf')
  assert.equal(result.files[0].parseJobId, 'parse-job-1')
  assert.deepEqual(
    queries.find(({ sql }) => sql.includes('INSERT INTO analysis_items')).params,
    [
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000203',
      'parse-job-1',
    ],
  )
  assert.equal(queries.find(({ sql }) => sql.includes('FROM job_descriptions')).params[1], 42)
  assert.deepEqual(
    queries.find(({ sql }) => sql.includes('INSERT INTO analyses')).params,
    [42, '00000000-0000-4000-8000-000000000201', 'Backend shortlist'],
  )
  assert.equal(released.length, 1)
})

test('analysis creation rejects another tenant or archived job before reserving quota', async () => {
  let quotaPrepared = false
  await assert.rejects(
    createResumeAnalysis({
      db: { async query() { return { rows: [] } } },
      userId: 42,
      analysisName: 'Private job analysis',
      jobDescriptionId: '00000000-0000-4000-8000-000000000211',
      files: [resumeFile()],
    }, {
      prepareQuota: async () => { quotaPrepared = true; return { reservationId: null } },
    }),
    (error) => error instanceof ResumeAnalysisCreationError
      && error.code === 'JOB_DESCRIPTION_NOT_FOUND',
  )
  assert.equal(quotaPrepared, false)
})

test('analysis creation records scan failures without enqueueing unsafe files', async () => {
  let enqueued = false
  const db = {
    async query(sql) {
      if (String(sql).includes('INSERT INTO analyses')) {
        return { rows: [{ id: '00000000-0000-4000-8000-000000000221' }] }
      }
      return { rows: [] }
    },
  }
  const result = await createResumeAnalysis({
    db,
    userId: 42,
    analysisName: 'Scanned batch',
    files: [resumeFile('unsafe.pdf')],
  }, {
    prepareQuota: async () => ({ reservationId: null }),
    scanFile: async () => ({ ok: false, reason: 'Malware detected' }),
    enqueue: async () => { enqueued = true },
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.queued, 0)
  assert.equal(result.failed, 1)
  assert.equal(result.files[0].reason, 'Malware detected')
  assert.equal(enqueued, false)
})
