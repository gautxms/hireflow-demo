import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildResumeQuotaBatchKey,
  buildResumeQuotaFileIdentity,
  preflightResumeQuota,
} from './resumeQuotaPreflight.js'

test('preflight reuses its idempotency key after a lost response', async (t) => {
  const requestKeys = []
  let attempt = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    attempt += 1
    const body = JSON.parse(options.body)
    requestKeys.push(body.quotaIdempotencyKey)
    if (attempt === 1) {
      throw new TypeError('connection reset after commit')
    }
    return {
      ok: true,
      json: async () => ({
        reservationId: '00000000-0000-4000-8000-000000000801',
        limit: 800,
        used: 10,
        remaining: 788,
      }),
    }
  })

  const batchKey = buildResumeQuotaBatchKey({
    files: [{ name: 'resume.pdf', size: 1024, lastModified: 123, type: 'application/pdf' }],
    context: 'Engineering:job-1',
  })

  await assert.rejects(
    preflightResumeQuota({ apiBase: '/api', token: 'token', fileCount: 1, batchKey }),
    /connection reset/,
  )
  const result = await preflightResumeQuota({
    apiBase: '/api',
    token: 'token',
    fileCount: 1,
    batchKey,
  })

  assert.equal(requestKeys.length, 2)
  assert.equal(requestKeys[0], requestKeys[1])
  assert.equal(result.quotaIdempotencyKey, requestKeys[0])
})

test('file identities distinguish same-named files within a stable batch', () => {
  const batchKey = buildResumeQuotaBatchKey({
    files: [
      { name: 'resume.pdf', size: 1024, lastModified: 100 },
      { name: 'resume.pdf', size: 1024, lastModified: 200 },
    ],
    context: 'batch',
  })

  assert.notEqual(
    buildResumeQuotaFileIdentity(batchKey, 0),
    buildResumeQuotaFileIdentity(batchKey, 1),
  )
  assert.equal(
    buildResumeQuotaFileIdentity(batchKey, 0),
    buildResumeQuotaFileIdentity(batchKey, 0),
  )
})
