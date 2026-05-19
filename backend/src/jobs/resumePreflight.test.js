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

test('routes low extractable-text ratio pdf to OCR fallback', () => {
  const fileBuffer = Buffer.concat([
    Buffer.from('%PDF-1.7\nxref\n%%EOF', 'latin1'),
    Buffer.alloc(12000, 0),
  ])
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
  assert.equal(result.textQuality.lowExtractableTextLikely, true)
  assert.equal(result.routeToOcr, true)
  assert.equal(typeof result.diagnostics.extractableTextRatio, 'number')
  assert.equal(typeof result.diagnostics.readableTokenRatio, 'number')
})

test('routes artifact-heavy extracted text to OCR fallback despite high text length', () => {
  const noisy = 'obj endobj stream endstream xref /Filter /Length '.repeat(200)
  const fileBuffer = Buffer.from(`%PDF-1.7\n${noisy}\n%%EOF`, 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
  assert.equal(result.textQuality.lowReadableQualityLikely, true)
  assert.equal(result.routeToOcr, true)
})

test('does not classify recruiter-like resume structure as low-signal without multiple strong negatives', () => {
  const resumeLikeText = `%PDF-1.7
Jane Doe
jane.doe@example.com | (415) 555-0199 | linkedin.com/in/janedoe | github.com/janedoe
Senior Software Engineer
Acme Corp | Jan 2020 - Present
Built hiring workflows and candidate ranking pipelines.
Globex | 2017-2019
Led backend projects and improved ATS integrations.
`.repeat(8)
  const fileBuffer = Buffer.from(resumeLikeText, 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
  assert.equal(result.textQuality.lowReadableQualityLikely, false)
  assert.equal(result.routeToOcr, false)
  assert.equal(result.diagnostics.recruiterLikeStructureLikely, true)
  assert.ok(result.diagnostics.resumeSignalCount >= 4)
})


test('does not throw and returns boolean diagnostics fields for valid PDF-like input', () => {
  const resumeLikeText = `%PDF-1.7
Jane Doe
jane.doe@example.com
Experience
Senior Software Engineer
Jan 2020 - Present
`.repeat(12)
  const fileBuffer = Buffer.from(resumeLikeText, 'latin1')

  assert.doesNotThrow(() => runResumePreflight({ mimeType: 'application/pdf', fileBuffer }))

  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
  assert.equal(typeof result.diagnostics.strongNegativeSignals, 'boolean')
  assert.equal(typeof result.diagnostics.recruiterLikeStructureLikely, 'boolean')
})

test('can still route to OCR when recruiter-like length is paired with multiple strong negatives', () => {
  const weakButLong = `%PDF-1.7
obj endobj stream endstream xref /Filter /Length
`.repeat(320)
  const fileBuffer = Buffer.from(weakButLong, 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
  assert.equal(result.textQuality.lowReadableQualityLikely, true)
  assert.equal(result.routeToOcr, true)
})

test('does not hard-fail compressed/binary PDF-like content before OCR/extraction', () => {
  const fileBuffer = Buffer.from('%PDF-1.5\n1 0 obj\n<< /Length 18 /Filter /FlateDecode >>\nstream\nx\x9c+I-.)V\x00\x00\x04]\x01\xc1\nendstream\nendobj\n', 'latin1')
  const result = runResumePreflight({ mimeType: 'application/pdf', fileBuffer })
  assert.equal(result.ok, true)
})

test('returns partial for low OCR confidence', () => {
  const result = evaluateOcrOutcome({ ocrConfidence: 50 })
  assert.equal(result.parseOutcome, 'partial')
  assert.equal(result.failureCategory, 'image_only_low_ocr')
  assert.equal(result.diagnostics.thresholdDecision, 'below_threshold')
})

test('does not terminal-fail OCR low confidence when guardrail conditions are met', () => {
  const result = evaluateOcrOutcome({
    ocrConfidence: 52,
    extractedTextLength: 1200,
    preflightDiagnostics: { readableTokenRatio: 0.64 },
  })
  assert.equal(result, null)
})
