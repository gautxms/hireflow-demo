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

  const baseName = '04_Vikram_Rao_Junior_SDE_Resume'
  const uploads = [
    { resumeId: '00000000-0000-0000-0000-000000000001', filename: `${baseName}.pdf`, mimeType: 'application/pdf', fileExtension: 'pdf' },
    { resumeId: '00000000-0000-0000-0000-000000000002', filename: `${baseName}.doc`, mimeType: 'application/msword', fileExtension: 'doc' },
    { resumeId: '00000000-0000-0000-0000-000000000003', filename: `${baseName}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileExtension: 'docx' },
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

  assert.deepEqual(addedJobs.map((job) => job.data.filename), uploads.map((upload) => upload.filename))
  assert.deepEqual(addedJobs.map((job) => job.data.originalFilename), uploads.map((upload) => upload.filename))
  assert.equal(new Set(addedJobs.map((job) => job.options.jobId)).size, 3)
  assert.deepEqual(addedJobs.map((job) => job.options.jobId), uploads.map((upload) => `resume:${upload.resumeId}`))
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


test('enqueueParseJob preserves assembled S3 reference metadata without requiring inline base64', async (t) => {
  const addedJobs = []
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('SELECT job_id')) return { rows: [] }
    return { rows: [] }
  })
  t.mock.method(parseQueue, 'add', async (data, options) => {
    addedJobs.push({ data, options })
    return { id: options.jobId, jobId: options.jobId }
  })

  await enqueueParseJob({
    resumeId: '00000000-0000-0000-0000-000000000101',
    userId: 42,
    filename: 'large.pdf',
    mimeType: 'application/pdf',
    fileExtension: 'pdf',
    fileSize: 100 * 1024 * 1024,
    assembledS3Key: 'uploads/session/assembled/large.pdf',
    assembledSha256: 'abc123',
  })

  assert.equal(addedJobs[0].data.assembledS3Key, 'uploads/session/assembled/large.pdf')
  assert.equal(addedJobs[0].data.assembledSha256, 'abc123')
  assert.equal(addedJobs[0].data.fileBufferBase64, null)
  assert.equal(addedJobs[0].data.fileSize, 100 * 1024 * 1024)
})
