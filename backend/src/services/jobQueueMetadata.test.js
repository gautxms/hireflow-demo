import test from 'node:test'
import assert from 'node:assert/strict'
import { enqueueParseJob, parseQueue } from './jobQueue.js'
import { pool } from '../db/client.js'

test('enqueueParseJob preserves distinct filename, extension, and MIME metadata for same basename uploads', async (t) => {
  t.after(async () => {
    await parseQueue.close().catch(() => {})
    await pool.end().catch(() => {})
  })
  const addedJobs = []

  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('SELECT job_id')) return { rows: [] }
    return { rows: [] }
  })

  t.mock.method(parseQueue, 'add', async (data, options) => {
    addedJobs.push({ data, options })
    return { id: options.jobId, jobId: options.jobId }
  })

  const uploads = [
    { resumeId: '00000000-0000-0000-0000-000000000001', filename: 'resume.pdf', mimeType: 'application/pdf', fileExtension: 'pdf' },
    { resumeId: '00000000-0000-0000-0000-000000000002', filename: 'resume.doc', mimeType: 'application/msword', fileExtension: 'doc' },
    { resumeId: '00000000-0000-0000-0000-000000000003', filename: 'resume.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileExtension: 'docx' },
  ]

  for (const upload of uploads) {
    await enqueueParseJob({
      ...upload,
      userId: 42,
      originalFilename: upload.filename,
      originalMimeType: upload.mimeType,
      fileBufferBase64: 'cmVzdW1l',
    })
  }

  assert.deepEqual(addedJobs.map((job) => job.data.filename), ['resume.pdf', 'resume.doc', 'resume.docx'])
  assert.deepEqual(addedJobs.map((job) => job.data.originalFilename), ['resume.pdf', 'resume.doc', 'resume.docx'])
  assert.deepEqual(addedJobs.map((job) => job.data.fileExtension), ['pdf', 'doc', 'docx'])
  assert.deepEqual(addedJobs.map((job) => job.data.mimeType), [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ])
  assert.deepEqual(addedJobs.map((job) => job.data.originalMimeType), [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ])
})
