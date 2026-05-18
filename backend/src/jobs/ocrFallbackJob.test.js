import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldPreferOcrText } from './ocrFallbackJob.js'

test('forceOcr prefers shorter but meaningful OCR text over huge garbage extraction text', () => {
  const extractionText = 'obj endobj stream endstream xref /Filter /Length '.repeat(250)
  const ocrText = 'Summary Experience Software Engineer Education Skills Projects JavaScript Node.js AWS PostgreSQL'
  const useOcr = shouldPreferOcrText({
    extractionText,
    ocrText,
    aiConfidence: 95,
    ocrConfidence: 72,
    forceOcr: true,
    preflightLowQuality: true,
  })
  assert.equal(useOcr, true)
})

test('forceOcr does not select empty/unusable OCR text', () => {
  const useOcr = shouldPreferOcrText({
    extractionText: 'obj endobj stream endstream '.repeat(200),
    ocrText: '',
    aiConfidence: 90,
    ocrConfidence: 0,
    forceOcr: true,
    preflightLowQuality: true,
  })
  assert.equal(useOcr, false)
})

test('non-force mode keeps readable longer extraction text', () => {
  const extractionText = 'Summary Experience Education Skills Projects Employment Certification React Node TypeScript SQL AWS '.repeat(20)
  const ocrText = 'summary skills node'
  const useOcr = shouldPreferOcrText({
    extractionText,
    ocrText,
    aiConfidence: 88,
    ocrConfidence: 70,
    forceOcr: false,
    preflightLowQuality: false,
  })
  assert.equal(useOcr, false)
})
