import test from 'node:test'
import assert from 'node:assert/strict'

import { hasCompleteChunkSet } from './fileUploadService.js'
import { isScanResultSafe } from './virusScanService.js'
import { shouldUseOcrFallback } from '../jobs/ocrFallbackJob.js'
import { isTerminalJobFailure } from '../jobs/parseResumeJob.js'
import { normalizeQueueCounts } from '../routes/admin/health.js'
import { redactValue } from '../routes/admin/logs.js'

test('chunk assembly validator rejects missing, duplicate, and out-of-order gaps', () => {
  assert.equal(hasCompleteChunkSet([0, 1, 2], 3), true)
  assert.equal(hasCompleteChunkSet([0, 2], 3), false)
  assert.equal(hasCompleteChunkSet([0, 1, 1], 3), false)
  assert.equal(hasCompleteChunkSet([1, 2, 3], 3), false)
})

test('virus scan safety classification enforces safe/unsafe states', () => {
  assert.equal(isScanResultSafe({ status: 'clean', malicious: false }), true)
  assert.equal(isScanResultSafe({ status: 'skipped', malicious: false }), true)
  assert.equal(isScanResultSafe({ status: 'timeout', malicious: false }), false)
  assert.equal(isScanResultSafe({ status: 'clean', malicious: true }), false)
})

test('ocr fallback decision only triggers for scanned/low-confidence/no-text inputs', () => {
  assert.equal(shouldUseOcrFallback({ scannedPdf: false, extractionLength: 5000, aiConfidence: 92 }), false)
  assert.equal(shouldUseOcrFallback({ scannedPdf: true, extractionLength: 5000, aiConfidence: 92 }), true)
  assert.equal(shouldUseOcrFallback({ scannedPdf: false, extractionLength: 0, aiConfidence: 92 }), true)
  assert.equal(shouldUseOcrFallback({ scannedPdf: false, extractionLength: 5000, aiConfidence: 69 }), true)
})

test('queue retry logic marks resume failed only on terminal failure', () => {
  assert.equal(isTerminalJobFailure({ attemptsMade: 0, opts: { attempts: 3 } }), false)
  assert.equal(isTerminalJobFailure({ attemptsMade: 1, opts: { attempts: 3 } }), false)
  assert.equal(isTerminalJobFailure({ attemptsMade: 2, opts: { attempts: 3 } }), true)
})

test('health queue response normalizes numeric counts safely', () => {
  const normalized = normalizeQueueCounts({ pending: '3', processing: '2', failed: null, succeeded: undefined })
  assert.deepEqual(normalized, {
    pending: 3,
    processing: 2,
    failed: 0,
    succeeded: 0,
  })
})

test('admin log redaction removes sensitive fields and emails', () => {
  const input = {
    token: 'abc',
    nested: {
      email: 'candidate@example.com',
      endpoint: '/api/uploads',
    },
    message: 'Failed for user candidate@example.com',
  }

  const redacted = redactValue(input)
  assert.equal(redacted.token, '[REDACTED]')
  assert.equal(redacted.nested.email, '[REDACTED]')
  assert.equal(redacted.nested.endpoint, '/api/uploads')
  assert.equal(redacted.message.includes('candidate@example.com'), false)
})
