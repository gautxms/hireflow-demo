import test from 'node:test'
import assert from 'node:assert/strict'
import {
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
  fields: { title: 'Backend Engineer', description: 'Full role text', skills: ['Node.js'] },
  warnings: [],
}

async function prepare() {
  return prepareJobDescriptionCreation(
    { userId: 42, file, signingSecret: secret },
    {
      now,
      previewId: 'd0dd847d-4c2f-4ae1-8423-08b24a84dc23',
      previewFile: async (received) => {
        assert.equal(received, file)
        return preview
      },
      storeFile: async (received) => {
        assert.deepEqual(received, { userId: 42, file })
        return storedFile
      },
    },
  )
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

test('confirmation atomically creates one file-backed job', async () => {
  const prepared = await prepare()
  const calls = []
  const job = { id: 'e228d8ad-30bb-4dd1-b5b2-85d2d765fe23', title: 'Backend Engineer' }
  const client = {
    async query(sql, params) {
      const text = String(sql)
      calls.push({ text, params })
      if (text.includes('INSERT INTO job_description_creation_requests')) return { rows: [{ id: 'request-1' }] }
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
    'INSERT INTO',
    'INSERT INTO',
    'UPDATE job_description_creation_requests',
    'COMMIT',
    'RELEASE',
  ])
  const jobInsert = calls.find((call) => call.text.includes('INSERT INTO job_descriptions'))
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
      if (text.includes('INSERT INTO job_description_creation_requests')) return { rows: [] }
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
      if (text.includes('INSERT INTO job_description_creation_requests')) return { rows: [{ id: 'request-1' }] }
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
