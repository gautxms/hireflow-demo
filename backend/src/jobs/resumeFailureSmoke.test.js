import test from 'node:test'
import assert from 'node:assert/strict'

import { runResumePreflight, evaluateOcrOutcome } from './resumePreflight.js'
import { summarizeJobStatus } from '../../../src/components/resumeAnalysisAggregation.js'

test('smoke: corrupted PDF fails preflight', () => {
  const fileBuffer = Buffer.from('%PDF-1.7\n%%EOF', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer, extractedTextHint: '' })
  assert.equal(result.ok, false)
  assert.equal(result.failureCategory, 'corrupted_pdf')
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

test('smoke: mixed batch summary includes at least one success', () => {
  const summary = summarizeJobStatus([
    { status: 'complete' },
    { status: 'failed' },
    { status: 'failed' },
  ])
  assert.deepEqual(summary, { uploaded: 3, analyzed: 1, failed: 2, pending: 0 })
})
