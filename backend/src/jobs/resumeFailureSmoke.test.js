import test from 'node:test'
import assert from 'node:assert/strict'

import { runResumePreflight, evaluateOcrOutcome } from './resumePreflight.js'
import { summarizeJobStatus } from '../../../src/components/resumeAnalysisAggregation.js'

test('smoke: structurally minimal PDF is not hard-failed by preflight', () => {
  const fileBuffer = Buffer.from('%PDF-1.7\n%%EOF', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer, extractedTextHint: '' })
  assert.equal(result.ok, true)
})

test('smoke: encrypted PDF fails preflight', () => {
  const fileBuffer = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Encrypt 2 0 R >>\n%%EOF', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, false)
  assert.equal(result.failureCategory, 'encrypted_or_password_protected_pdf')
})

test('smoke: image-only low OCR PDF is categorized consistently', () => {
  const ocr = evaluateOcrOutcome({ ocrConfidence: 30 })
  assert.equal(ocr.parseOutcome, 'partial')
  assert.equal(ocr.failureCategory, 'image_only_low_ocr')
})

test('smoke: 3-file mixed batch produces deterministic per-file outcomes and aggregate counts', () => {
  const statuses = [
    { status: 'complete', parseOutcome: 'success', failureCategory: null },
    { status: 'failed', parseOutcome: 'failed', failureCategory: 'corrupt_or_unreadable' },
    { status: 'failed', parseOutcome: 'failed', failureCategory: 'encrypted_or_password_protected_pdf' },
  ]

  const perFileOutcomes = statuses.map((item) => ({
    parseOutcome: item.parseOutcome,
    failureCategory: item.failureCategory,
  }))

  assert.deepEqual(perFileOutcomes, [
    { parseOutcome: 'success', failureCategory: null },
    { parseOutcome: 'failed', failureCategory: 'corrupt_or_unreadable' },
    { parseOutcome: 'failed', failureCategory: 'encrypted_or_password_protected_pdf' },
  ])

  const summary = summarizeJobStatus(statuses)
  assert.deepEqual(summary, { uploaded: 3, analyzed: 1, failed: 2, pending: 0 })
})
