import test from 'node:test'
import assert from 'node:assert/strict'
import {
  issueJobDescriptionPreviewReceipt,
  JobDescriptionPreviewReceiptError,
  verifyJobDescriptionPreviewReceipt,
} from './jobDescriptionPreviewReceiptService.js'

const secret = 'test-only-signing-secret-with-enough-entropy'
const now = Date.UTC(2026, 9, 20, 12, 0, 0)
const storedFile = {
  fileUrl: 's3://hireflow/job-descriptions/42/hash/role.pdf',
  fileSha256: 'a'.repeat(64),
  fileName: 'role.pdf',
  contentType: 'application/pdf',
}
const preview = {
  fields: { title: 'Platform Engineer', description: 'Confidential role text' },
  warnings: [],
}

test('issues a short-lived receipt bound to the account and stored source file', () => {
  const issued = issueJobDescriptionPreviewReceipt({
    userId: 42,
    preview,
    storedFile,
    secret,
    now,
    previewId: '9b42ba34-8d34-4277-8814-4c099cf65acf',
  })
  const verified = verifyJobDescriptionPreviewReceipt({
    token: issued.token,
    userId: 42,
    secret,
    now: now + 1_000,
  })

  assert.equal(verified.previewId, '9b42ba34-8d34-4277-8814-4c099cf65acf')
  assert.deepEqual(verified.file, storedFile)
  assert.equal(verified.previewSha256.length, 64)
  assert.equal(issued.expiresAt, new Date(now + 30 * 60 * 1000).toISOString())
  const decodedPayload = Buffer.from(issued.token.split('.')[0], 'base64url').toString('utf8')
  assert.doesNotMatch(decodedPayload, /Confidential role text|Platform Engineer/)
})

test('rejects tampering, another account, and expired receipts with stable codes', () => {
  const { token } = issueJobDescriptionPreviewReceipt({ userId: 42, preview, storedFile, secret, now })
  const [payload, signature] = token.split('.')

  assert.throws(
    () => verifyJobDescriptionPreviewReceipt({ token: `${payload}x.${signature}`, userId: 42, secret, now }),
    (error) => error instanceof JobDescriptionPreviewReceiptError && error.code === 'JD_PREVIEW_TOKEN_INVALID',
  )
  assert.throws(
    () => verifyJobDescriptionPreviewReceipt({ token, userId: 7, secret, now }),
    (error) => error instanceof JobDescriptionPreviewReceiptError
      && error.code === 'JD_PREVIEW_TOKEN_FORBIDDEN'
      && error.status === 403,
  )
  assert.throws(
    () => verifyJobDescriptionPreviewReceipt({ token, userId: 42, secret, now: now + 30 * 60 * 1000 }),
    (error) => error instanceof JobDescriptionPreviewReceiptError
      && error.code === 'JD_PREVIEW_TOKEN_EXPIRED'
      && error.status === 410,
  )
})
