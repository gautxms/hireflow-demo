import { Buffer } from 'node:buffer'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { S3Client } from '@aws-sdk/client-s3'
import { pool } from '../db/client.js'

process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'test-bucket'
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1'

const service = await import('./fileUploadService.js')
const { parseQueue } = await import('./jobQueue.js')

after(async () => {
  await parseQueue.close()
  await pool.end()
})

function mockServiceQueries(t, handler) {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return handler(sql, params, queries)
  })
  return queries
}

function mockS3(t, handler) {
  const commands = []
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    commands.push(command)
    return handler(command, commands)
  })
  return commands
}

test('initChunkUpload stores a tenant-namespaced S3 prefix for new sessions without changing the response shape', async (t) => {
  const queries = mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('INSERT INTO analyses')) return { rows: [{ id: '00000000-0000-4000-8000-000000000101' }] }
    if (sql.includes('FROM upload_chunks') && sql.includes("status = 'uploading'")) return { rows: [] }
    if (sql.includes('INSERT INTO upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const result = await service.initChunkUpload({
    userId: 42,
    filename: 'Resume.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
  })

  assert.deepEqual(Object.keys(result).sort(), ['analysisId', 'resumed', 'totalChunks', 'uploadId', 'uploadedChunks'].sort())
  assert.equal(result.resumed, false)

  const insert = queries.find(({ sql }) => sql.includes('INSERT INTO upload_chunks'))
  assert.ok(insert)
  assert.equal(insert.params[7], `users/42/uploads/${result.uploadId}`)
})

test('storeChunk writes new tenant-prefixed chunk keys from persisted s3_prefix', async (t) => {
  const uploadId = '00000000-0000-4000-8000-000000000201'
  const prefix = `users/1/uploads/${uploadId}`
  mockServiceQueries(t, (sql) => {
    if (sql.includes('SELECT upload_id, user_id, total_chunks, status, s3_prefix')) {
      return { rows: [{ upload_id: uploadId, user_id: 1, total_chunks: 2, status: 'uploading', s3_prefix: prefix }] }
    }
    if (sql.includes('UPDATE upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })
  const commands = mockS3(t, () => ({}))

  await service.storeChunk({ userId: 1, uploadId, chunkIndex: 1, totalChunks: 2, chunkBuffer: Buffer.from('b') })

  assert.equal(commands[0].input.Key, `${prefix}/chunks/1`)
})

test('storeChunk preserves old uploads/<uploadId> chunk keys from persisted s3_prefix', async (t) => {
  const uploadId = '00000000-0000-4000-8000-000000000202'
  const prefix = `uploads/${uploadId}`
  mockServiceQueries(t, (sql) => {
    if (sql.includes('SELECT upload_id, user_id, total_chunks, status, s3_prefix')) {
      return { rows: [{ upload_id: uploadId, user_id: 1, total_chunks: 1, status: 'uploading', s3_prefix: prefix }] }
    }
    if (sql.includes('UPDATE upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })
  const commands = mockS3(t, () => ({}))

  await service.storeChunk({ userId: 1, uploadId, chunkIndex: 0, totalChunks: 1, chunkBuffer: Buffer.from('a') })

  assert.equal(commands[0].input.Key, `${prefix}/chunks/0`)
})

test('completeChunkUpload uses persisted s3_prefix for reading chunks, assembling, and cleanup while preserving parse job payload shape', async (t) => {
  const uploadId = '00000000-0000-4000-8000-000000000301'
  const resumeId = '00000000-0000-4000-8000-000000000302'
  const analysisId = '00000000-0000-4000-8000-000000000303'
  const prefix = `uploads/${uploadId}`
  const sentPayloads = []

  mockServiceQueries(t, (sql) => {
    if (sql.includes('SELECT upload_id, user_id, filename') && sql.includes('s3_prefix')) {
      return { rows: [{
        upload_id: uploadId,
        user_id: 7,
        filename: 'resume.pdf',
        mime_type: 'application/pdf',
        file_size: 6,
        total_chunks: 2,
        uploaded_chunks: [0, 1],
        status: 'uploading',
        job_description_id: null,
        resume_id: null,
        analysis_id: analysisId,
        s3_prefix: prefix,
      }] }
    }
    if (sql.includes('SELECT job_id')) return { rows: [] }
    if (sql.includes('INSERT INTO parse_jobs')) return { rows: [] }
    if (sql.includes('UPDATE upload_chunks') || sql.includes('INSERT INTO analysis_items')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  t.mock.method(pool, 'connect', async () => ({
    query: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
      if (sql.includes('SELECT status, resume_id, parse_job_id')) return { rows: [{ status: 'uploading', resume_id: null, parse_job_id: null }] }
      if (sql.includes('INSERT INTO resumes')) return { rows: [{ id: resumeId }] }
      if (sql.includes('UPDATE upload_chunks')) return { rows: [] }
      throw new Error(`Unexpected transaction query: ${sql}`)
    },
    release: () => {},
  }))

  t.mock.method(parseQueue, 'getJob', async () => null)
  t.mock.method(parseQueue, 'add', async (payload) => {
    sentPayloads.push(payload)
    return { id: `resume:${resumeId}` }
  })

  const commands = mockS3(t, (command) => {
    if (command.constructor.name === 'GetObjectCommand') {
      return { Body: command.input.Key.endsWith('/chunks/0') ? Buffer.from('abc') : Buffer.from('def') }
    }
    return {}
  })

  await service.completeChunkUpload({ userId: 7, uploadId })

  assert.equal(commands[0].input.Key, `${prefix}/chunks/0`)
  assert.equal(commands[1].input.Key, `${prefix}/chunks/1`)
  assert.equal(commands[2].input.Key, `${prefix}/assembled/resume.pdf`)
  assert.deepEqual(commands[3].input.Delete.Objects.map((object) => object.Key), [`${prefix}/chunks/0`, `${prefix}/chunks/1`])
  assert.deepEqual(Object.keys(sentPayloads[0]).sort(), [
    'analysisId',
    'fileBufferBase64',
    'fileExtension',
    'fileSize',
    'filename',
    'jobDescriptionId',
    'mimeType',
    'originalFilename',
    'originalMimeType',
    'resumeId',
    'userId',
  ].sort())
})

test('cleanupExpiredChunkUploads deletes objects using stored prefixes without assuming tenant namespace', async (t) => {
  const uploadId = '00000000-0000-4000-8000-000000000401'
  const prefix = `uploads/${uploadId}`
  mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('SELECT upload_id, s3_prefix')) return { rows: [{ upload_id: uploadId, s3_prefix: prefix }], rowCount: 1 }
    if (sql.includes('UPDATE upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })
  const commands = mockS3(t, (command) => {
    if (command.constructor.name === 'ListObjectsV2Command') {
      return { Contents: [{ Key: `${prefix}/chunks/0` }, { Key: `${prefix}/assembled/resume.pdf` }] }
    }
    return {}
  })

  const count = await service.cleanupExpiredChunkUploads()

  assert.equal(count, 1)
  assert.equal(commands[0].input.Prefix, prefix)
  assert.deepEqual(commands[1].input.Delete.Objects.map((object) => object.Key), [`${prefix}/chunks/0`, `${prefix}/assembled/resume.pdf`])
})
