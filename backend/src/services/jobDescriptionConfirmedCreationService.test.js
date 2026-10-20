import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanupExpiredJobDescriptionPreviews,
  confirmJobDescriptionCreation,
  prepareJobDescriptionCreation,
} from './jobDescriptionConfirmedCreationService.js'
import { verifyJobDescriptionPreviewReceipt } from './jobDescriptionPreviewReceiptService.js'

const secret = 'test-only-signing-secret-with-enough-entropy'
const now = Date.UTC(2026, 9, 20, 12, 0, 0)
const file = {
  originalname: 'role.pdf',
  mimetype: 'application/pdf',
  buffer: Buffer.from('%PDF test job description'),
}
const storedFile = {
  fileUrl: 's3://hireflow/job-descriptions/42/hash/role.pdf',
  fileSha256: 'b'.repeat(64),
  fileName: 'role.pdf',
  contentType: 'application/pdf',
}
const preview = {
  fields: {
    title: 'Backend Engineer',
    description: 'Full role text',
    skills: ['Node.js'],
    workMode: 'remote',
  },
  warnings: [],
}

async function prepare() {
  const preparationQueries = []
  return prepareJobDescriptionCreation(
    {
      db: {
        async query(sql, params) {
          preparationQueries.push({ sql: String(sql), params })
          return { rows: [] }
        },
      },
      userId: 42,
      file,
      signingSecret: secret,
    },
    {
      now,
      previewId: 'd0dd847d-4c2f-4ae1-8423-08b24a84dc23',
      previewFile: async (received) => {
        assert.equal(received, file)
        return preview
      },
      storeFile: async (received) => {
        assert.deepEqual(received, {
          userId: 42,
          file,
          previewId: 'd0dd847d-4c2f-4ae1-8423-08b24a84dc23',
        })
        return storedFile
      },
    },
  ).then((result) => {
    assert.equal(preparationQueries.length, 1)
    assert.match(preparationQueries[0].sql, /INSERT INTO job_description_creation_requests/)
    assert.match(preparationQueries[0].sql, /'pending'/)
    return result
  })
}

test('previews first, persists the source file, and returns a signed confirmation token', async () => {
  const prepared = await prepare()
  assert.deepEqual(prepared.fields, preview.fields)
  assert.deepEqual(prepared.sourceFile, { name: 'role.pdf', sha256: 'b'.repeat(64) })

  const receipt = verifyJobDescriptionPreviewReceipt({
    token: prepared.previewToken,
    userId: 42,
    secret,
    now,
  })
  assert.equal(receipt.file.fileUrl, storedFile.fileUrl)
  assert.equal(receipt.expiresAt, prepared.previewExpiresAt)
})

test('removes the isolated source file if pending-preview tracking fails', async () => {
  const deletedFiles = []
  await assert.rejects(
    prepareJobDescriptionCreation(
      {
        db: { async query() { throw new Error('database unavailable') } },
        userId: 42,
        file,
        signingSecret: secret,
      },
      {
        now,
        previewId: 'd0dd847d-4c2f-4ae1-8423-08b24a84dc23',
        previewFile: async () => preview,
        storeFile: async () => storedFile,
        deleteFile: async ({ fileUrl }) => deletedFiles.push(fileUrl),
      },
    ),
    /database unavailable/,
  )
  assert.deepEqual(deletedFiles, [storedFile.fileUrl])
})

test('confirmation atomically creates one file-backed job', async () => {
  const prepared = await prepare()
  const calls = []
  const job = { id: 'e228d8ad-30bb-4dd1-b5b2-85d2d765fe23', title: 'Backend Engineer' }
  const client = {
    async query(sql, params) {
      const text = String(sql)
      calls.push({ text, params })
      if (text.includes("SET status = 'processing'")) return { rows: [{ id: 'request-1' }] }
      if (text.includes('INSERT INTO job_descriptions')) return { rows: [job] }
      return { rows: [] }
    },
    release() { calls.push({ text: 'RELEASE' }) },
  }

  const result = await confirmJobDescriptionCreation({
    db: { async connect() { return client } },
    userId: 42,
    input: { ...prepared.fields, title: ' Backend Engineer ' },
    previewToken: prepared.previewToken,
    signingSecret: secret,
  }, { now })

  assert.deepEqual(result, {
    job,
    created: true,
    sourceFile: { name: 'role.pdf', sha256: 'b'.repeat(64) },
  })
  assert.deepEqual(calls.map((call) => call.text === 'RELEASE' ? call.text : call.text.trim().split(/\s+/).slice(0, 2).join(' ')), [
    'BEGIN',
    'UPDATE job_description_creation_requests',
    'INSERT INTO',
    'UPDATE job_description_creation_requests',
    'COMMIT',
    'RELEASE',
  ])
  const jobInsert = calls.find((call) => call.text.includes('INSERT INTO job_descriptions'))
  assert.equal(jobInsert.params[14], 'remote')
  assert.equal(jobInsert.params[18], 'file')
  assert.equal(jobInsert.params[20], storedFile.fileUrl)
})

test('a retry returns the existing job without creating a duplicate', async () => {
  const prepared = await prepare()
  const existingJob = { id: 'existing-job', title: 'Backend Engineer' }
  let jobInsertCount = 0
  const client = {
    async query(sql) {
      const text = String(sql)
      if (text.includes("SET status = 'processing'")) return { rows: [] }
      if (text.includes('SELECT job_description.*')) return { rows: [existingJob] }
      if (text.includes('INSERT INTO job_descriptions')) jobInsertCount += 1
      return { rows: [] }
    },
    release() {},
  }

  const result = await confirmJobDescriptionCreation({
    db: { async connect() { return client } },
    userId: 42,
    input: prepared.fields,
    previewToken: prepared.previewToken,
    signingSecret: secret,
  }, { now })

  assert.equal(result.created, false)
  assert.equal(result.job, existingJob)
  assert.equal(jobInsertCount, 0)
})

test('invalid confirmation fails before opening a database transaction', async () => {
  const prepared = await prepare()
  let connected = false
  await assert.rejects(
    confirmJobDescriptionCreation({
      db: { async connect() { connected = true } },
      userId: 7,
      input: prepared.fields,
      previewToken: prepared.previewToken,
      signingSecret: secret,
    }, { now }),
    { code: 'JD_PREVIEW_TOKEN_FORBIDDEN' },
  )
  assert.equal(connected, false)
})

test('a failed job insert rolls back and releases the client', async () => {
  const prepared = await prepare()
  const calls = []
  const client = {
    async query(sql) {
      const text = String(sql)
      calls.push(text.trim())
      if (text.includes("SET status = 'processing'")) return { rows: [{ id: 'request-1' }] }
      if (text.includes('INSERT INTO job_descriptions')) throw new Error('database unavailable')
      return { rows: [] }
    },
    release() { calls.push('RELEASE') },
  }

  await assert.rejects(
    confirmJobDescriptionCreation({
      db: { async connect() { return client } },
      userId: 42,
      input: prepared.fields,
      previewToken: prepared.previewToken,
      signingSecret: secret,
    }, { now }),
    /database unavailable/,
  )
  assert.equal(calls.at(-2), 'ROLLBACK')
  assert.equal(calls.at(-1), 'RELEASE')
})

test('expired unconfirmed previews delete their source file and pending record only', async () => {
  const deletedFiles = []
  const queries = []
  let claimCount = 0
  const db = {
    async query(sql, params) {
      const text = String(sql)
      queries.push({ text, params })
      if (text.includes('WITH cleanup_candidates')) {
        claimCount += 1
        return {
          rows: claimCount === 1
            ? [{ id: 'pending-1', file_url: storedFile.fileUrl }]
            : [],
        }
      }
      if (text.includes('DELETE FROM job_description_creation_requests')) {
        assert.match(text, /status = 'cleaning'/)
        return { rows: [{ id: 'pending-1' }] }
      }
      throw new Error(`Unexpected cleanup query: ${text}`)
    },
  }

  const cleaned = await cleanupExpiredJobDescriptionPreviews({
    db,
    deleteFile: async ({ fileUrl }) => deletedFiles.push(fileUrl),
  })

  assert.equal(cleaned, 1)
  assert.deepEqual(deletedFiles, [storedFile.fileUrl])
  assert.equal(queries.length, 3)
  assert.match(queries[0].text, /FOR UPDATE SKIP LOCKED/)
  assert.match(queries[0].text, /SET status = 'cleaning'/)
  assert.match(queries[0].text, /LIMIT 100/)
  assert.match(queries[2].text, /WITH cleanup_candidates/)
})

test('failed preview cleanup releases its claim with retry backoff metadata intact', async (t) => {
  t.mock.method(console, 'error', () => {})
  let claimCount = 0
  const queries = []
  const db = {
    async query(sql, params) {
      const text = String(sql)
      queries.push({ text, params })
      if (text.includes('WITH cleanup_candidates')) {
        claimCount += 1
        return {
          rows: claimCount === 1
            ? [{ id: 'pending-1', file_url: storedFile.fileUrl }]
            : [],
        }
      }
      if (text.includes("SET status = 'pending'")) return { rows: [] }
      throw new Error(`Unexpected cleanup query: ${text}`)
    },
  }

  const cleaned = await cleanupExpiredJobDescriptionPreviews({
    db,
    deleteFile: async () => { throw new Error('temporary S3 failure') },
  })

  assert.equal(cleaned, 0)
  assert.match(queries[0].text, /cleanup_attempted_at <= NOW\(\) - INTERVAL '15 minutes'/)
  assert.match(queries[1].text, /SET status = 'pending'/)
  assert.match(queries[2].text, /WITH cleanup_candidates/)
})
