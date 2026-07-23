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

test('initChunkUpload keeps same-named same-sized batch files in distinct identified sessions', async (t) => {
  const queries = mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('FROM upload_chunks') && sql.includes('file_identity')) return { rows: [] }
    if (sql.includes('FROM analyses')) return { rows: [{ id: '00000000-0000-4000-8000-000000000111' }] }
    if (sql.includes('INSERT INTO upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const common = {
    userId: 42,
    filename: 'Resume.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    analysisId: '00000000-0000-4000-8000-000000000111',
  }
  const first = await service.initChunkUpload({ ...common, fileIdentity: 'batch-key:0' })
  const second = await service.initChunkUpload({ ...common, fileIdentity: 'batch-key:1' })

  assert.notEqual(first.uploadId, second.uploadId)
  const inserts = queries.filter(({ sql }) => sql.includes('INSERT INTO upload_chunks'))
  assert.equal(inserts.length, 2)
  assert.equal(inserts[0].params[11], 'batch-key:0')
  assert.equal(inserts[1].params[11], 'batch-key:1')
})

test('initChunkUpload resumes an identified session before creating another analysis', async (t) => {
  const existingAnalysisId = '00000000-0000-4000-8000-000000000121'
  const existingUploadId = '00000000-0000-4000-8000-000000000122'
  const queries = mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('FROM upload_chunks') && sql.includes('file_identity')) {
      return {
        rows: [{
          upload_id: existingUploadId,
          uploaded_chunks: [0],
          total_chunks: 1,
          quota_recorded: true,
          quota_reservation_id: '00000000-0000-4000-8000-000000000123',
          analysis_id: existingAnalysisId,
        }],
      }
    }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const result = await service.initChunkUpload({
    userId: 42,
    filename: 'Resume.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    fileIdentity: 'stable-batch:0',
  })

  assert.equal(result.resumed, true)
  assert.equal(result.uploadId, existingUploadId)
  assert.equal(result.analysisId, existingAnalysisId)
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO analyses')), false)
})

test('initChunkUpload atomically reloads the winning identified session after an insert conflict', async (t) => {
  const winningUploadId = '00000000-0000-4000-8000-000000000131'
  const winningAnalysisId = '00000000-0000-4000-8000-000000000132'
  mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('FROM upload_chunks') && sql.includes('file_identity')) return { rows: [] }
    if (sql.includes('FROM analyses')) return { rows: [{ id: winningAnalysisId }] }
    if (sql.includes('INSERT INTO upload_chunks')) {
      assert.match(sql, /ON CONFLICT \(user_id, file_identity\)/)
      assert.match(sql, /RETURNING upload_id/)
      return { rows: [{
        upload_id: winningUploadId,
        total_chunks: 1,
        uploaded_chunks: [],
        analysis_id: winningAnalysisId,
        quota_recorded: false,
        quota_reservation_id: '00000000-0000-4000-8000-000000000133',
      }] }
    }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const result = await service.initChunkUpload({
    userId: 42,
    filename: 'Resume.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    analysisId: winningAnalysisId,
    quotaReservationId: '00000000-0000-4000-8000-000000000133',
    fileIdentity: 'stable-batch:race',
  })

  assert.equal(result.uploadId, winningUploadId)
  assert.equal(result.resumed, true)
  assert.equal(service.getChunkUploadQuotaState(result).quotaRecorded, false)
})

test('initChunkUpload uses clientChunkSize to calculate 25 MiB uploads with 4 MiB chunks', async (t) => {
  const fileSize = 25 * 1024 * 1024
  const clientChunkSize = 4 * 1024 * 1024
  const queries = mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('INSERT INTO analyses')) return { rows: [{ id: '00000000-0000-4000-8000-000000000501' }] }
    if (sql.includes('FROM upload_chunks') && sql.includes("status = 'uploading'")) return { rows: [] }
    if (sql.includes('INSERT INTO upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const result = await service.initChunkUpload({
    userId: 42,
    filename: 'large.pdf',
    fileSize,
    mimeType: 'application/pdf',
    clientChunkSize,
  })

  assert.equal(result.totalChunks, 7)
  const insert = queries.find(({ sql }) => sql.includes('INSERT INTO upload_chunks'))
  assert.equal(insert.params[5], 7)
})

test('initChunkUpload defaults to backend chunk size when clientChunkSize is omitted', async (t) => {
  const fileSize = 25 * 1024 * 1024
  const queries = mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('INSERT INTO analyses')) return { rows: [{ id: '00000000-0000-4000-8000-000000000502' }] }
    if (sql.includes('FROM upload_chunks') && sql.includes("status = 'uploading'")) return { rows: [] }
    if (sql.includes('INSERT INTO upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const result = await service.initChunkUpload({
    userId: 42,
    filename: 'legacy.pdf',
    fileSize,
    mimeType: 'application/pdf',
  })

  assert.equal(result.totalChunks, 5)
  const insert = queries.find(({ sql }) => sql.includes('INSERT INTO upload_chunks'))
  assert.equal(insert.params[5], 5)
})


test('initChunkUpload accepts explicit backend chunk size clientChunkSize', async (t) => {
  const fileSize = 25 * 1024 * 1024
  const queries = mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('INSERT INTO analyses')) return { rows: [{ id: '00000000-0000-4000-8000-000000000504' }] }
    if (sql.includes('FROM upload_chunks') && sql.includes("status = 'uploading'")) return { rows: [] }
    if (sql.includes('INSERT INTO upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const result = await service.initChunkUpload({
    userId: 42,
    filename: 'explicit-backend-chunk.pdf',
    fileSize,
    mimeType: 'application/pdf',
    clientChunkSize: 5 * 1024 * 1024,
  })

  assert.equal(result.totalChunks, 5)
  const insert = queries.find(({ sql }) => sql.includes('INSERT INTO upload_chunks'))
  assert.equal(insert.params[5], 5)
})

test('initChunkUpload rejects unsupported tiny clientChunkSize values', async (t) => {
  mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  await assert.rejects(
    service.initChunkUpload({
      userId: 42,
      filename: 'tiny-chunk.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      clientChunkSize: 1,
    }),
    /clientChunkSize must be 4MB or 5MB/,
  )
})

test('initChunkUpload rejects clientChunkSize over the backend chunk size limit', async (t) => {
  mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  await assert.rejects(
    service.initChunkUpload({
      userId: 42,
      filename: 'too-large-chunk.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      clientChunkSize: (5 * 1024 * 1024) + 1,
    }),
    /clientChunkSize must be 4MB or 5MB/,
  )
})

test('initChunkUpload rejects files over 25 MiB even with clientChunkSize', async (t) => {
  mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  await assert.rejects(
    service.initChunkUpload({
      userId: 42,
      filename: 'too-large.pdf',
      fileSize: (26 * 1024 * 1024),
      mimeType: 'application/pdf',
      clientChunkSize: 4 * 1024 * 1024,
    }),
    /Files above 25MB are not supported yet/,
  )
})

test('storeChunk accepts totalChunks from sessions initialized with 4 MiB client chunks', async (t) => {
  const uploadId = '00000000-0000-4000-8000-000000000503'
  const prefix = `users/1/uploads/${uploadId}`
  mockServiceQueries(t, (sql) => {
    if (sql.includes('SELECT upload_id, user_id, total_chunks, status, s3_prefix')) {
      return { rows: [{ upload_id: uploadId, user_id: 1, total_chunks: 25, status: 'uploading', s3_prefix: prefix }] }
    }
    if (sql.includes('UPDATE upload_chunks')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })
  const commands = mockS3(t, () => ({}))

  await service.storeChunk({ userId: 1, uploadId, chunkIndex: 24, totalChunks: 25, chunkBuffer: Buffer.from('z') })

  assert.equal(commands[0].input.Key, `${prefix}/chunks/24`)
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

test('completeChunkUpload uses persisted s3_prefix for reading chunks, assembling, and cleanup while enqueuing an S3 reference instead of an inline base64 payload', async (t) => {
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
    'assembledS3Key',
    'assembledSha256',
    'fileBufferBase64',
    'fileExtension',
    'fileSize',
    'filename',
    'jobDescriptionId',
    'mimeType',
    'originalFilename',
    'originalMimeType',
    'quotaAllocationId',
    'resumeId',
    'userId',
  ].sort())
  assert.equal(sentPayloads[0].assembledS3Key, `${prefix}/assembled/resume.pdf`)
  assert.equal(sentPayloads[0].assembledSha256, 'bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721')
  assert.equal(sentPayloads[0].fileBufferBase64, null)
})

test('cleanupExpiredChunkUploads deletes objects using stored prefixes without assuming tenant namespace', async (t) => {
  const uploadId = '00000000-0000-4000-8000-000000000401'
  const prefix = `uploads/${uploadId}`
  mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('SELECT upload_id, user_id, s3_prefix, quota_allocation_id')) {
      return {
        rows: [{
          upload_id: uploadId,
          user_id: 7,
          s3_prefix: prefix,
          quota_allocation_id: null,
        }],
        rowCount: 1,
      }
    }
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

test('cleanupExpiredChunkUploads retries an expired upload when quota release fails', async (t) => {
  const uploadId = '00000000-0000-4000-8000-000000000402'
  const allocationId = '00000000-0000-4000-8000-000000000403'
  const prefix = `uploads/${uploadId}`
  let markedExpired = false

  mockServiceQueries(t, (sql) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('ALTER TABLE')) return { rows: [] }
    if (sql.includes('SELECT upload_id, user_id, s3_prefix, quota_allocation_id')) {
      return {
        rows: [{
          upload_id: uploadId,
          user_id: 7,
          s3_prefix: prefix,
          quota_allocation_id: allocationId,
        }],
        rowCount: 1,
      }
    }
    if (sql.includes('UPDATE upload_chunks')) {
      markedExpired = true
      return { rows: [] }
    }
    throw new Error(`Unexpected query: ${sql}`)
  })
  t.mock.method(pool, 'connect', async () => {
    throw new Error('transient database failure')
  })
  mockS3(t, (command) => {
    if (command.constructor.name === 'ListObjectsV2Command') {
      return { Contents: [{ Key: `${prefix}/chunks/0` }] }
    }
    return {}
  })

  const count = await service.cleanupExpiredChunkUploads()

  assert.equal(count, 0)
  assert.equal(markedExpired, false)
})
