import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateOcrOutcome, runResumePreflight } from './resumePreflight.js'

test('fails encrypted pdf preflight', () => {
  const fileBuffer = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Encrypt 2 0 R >>\n%%EOF', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, false)
  assert.equal(result.failureCategory, 'encrypted_or_password_protected_pdf')
})

test('routes likely image-only PDF to OCR', () => {
  const fileBuffer = Buffer.concat([Buffer.from('%PDF-1.7\nxref\n%%EOF', 'latin1'), Buffer.alloc(6000, 0)])
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
  assert.equal(result.routeToOcr, true)
})

test('does not hard-fail compressed/binary PDF-like content before OCR/extraction', () => {
  const fileBuffer = Buffer.from('%PDF-1.5\n1 0 obj\n<< /Length 18 /Filter /FlateDecode >>\nstream\nx\x9c+I-.)V\x00\x00\x04]\x01\xc1\nendstream\nendobj\n', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
})

test('does not hard-fail valid PDFs containing HTML or JSON snippets in content', () => {
  const fileBuffer = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Length 70 >>\nstream\n<html><body>portfolio sample</body></html>\n{"error":"demo json"}\nendstream\nendobj\n', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
})

test('hard-fails header-spoofed HTML payloads that lack PDF structure', () => {
  const fileBuffer = Buffer.from('%PDF-1.7\n<html><body>not actually a PDF</body></html>', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, false)
  assert.equal(result.failureCategory, 'unsupported_encoding_or_format')
})

test('hard-fails header-spoofed payloads with incidental stream wording but no PDF markers', () => {
  const fileBuffer = Buffer.from('%PDF-1.7\n<html>download stream unavailable</html>', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, false)
  assert.equal(result.failureCategory, 'unsupported_encoding_or_format')
})

test('returns partial for low OCR confidence', () => {
  const result = evaluateOcrOutcome({ ocrConfidence: 50 })
  assert.equal(result.parseOutcome, 'partial')
  assert.equal(result.failureCategory, 'image_only_low_ocr')
})
