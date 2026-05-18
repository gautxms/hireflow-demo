import test from 'node:test'
import assert from 'node:assert/strict'
import { runParseWithOcrFallback, shouldPreferOcrText } from './ocrFallbackJob.js'

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

test('usable pdf_text selects pdf_text with single-pass stage attempts', async () => {
  const counters = { extract: 0, ocr: 0, capability: 0 }
  const result = await runParseWithOcrFallback({
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    fileSize: 1000,
    fileBuffer: Buffer.from('pdf'),
    dependencies: {
      extractTextFromResumeFn: async () => {
        counters.extract += 1
        return { text: 'Experience Education Skills Projects '.repeat(30), method: 'pdf_text', length: 1080 }
      },
      isLikelyScannedPdfFn: () => false,
      runOcrWithCacheFn: async () => {
        counters.ocr += 1
        return { text: '', confidence: 0, method: 'ocr', provider: 'mock' }
      },
      resolveDirectPdfVisionCapabilityFn: () => {
        counters.capability += 1
        return { supported: false }
      },
    },
  })
  assert.equal(result.methodUsed, 'pdf_text')
  assert.equal(result.stageDiagnostics.pdf_text.status, 'success')
  assert.equal(result.stageDiagnostics.ocr.attempted, false)
  assert.equal(result.stageDiagnostics.direct_pdf_vision.attempted, false)
  assert.equal(result.attempts.length, 1)
  assert.deepEqual(counters, { extract: 1, ocr: 0, capability: 0 })
})

test('weak pdf_text + usable OCR selects ocr in single pass', async () => {
  const counters = { extract: 0, ocr: 0, capability: 0 }
  const result = await runParseWithOcrFallback({
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    fileSize: 20000,
    fileBuffer: Buffer.from('pdf'),
    dependencies: {
      extractTextFromResumeFn: async () => {
        counters.extract += 1
        return { text: 'tiny', method: 'pdf_text', length: 4 }
      },
      isLikelyScannedPdfFn: () => true,
      runOcrWithCacheFn: async () => {
        counters.ocr += 1
        const text = 'Experience Software Engineer Education BS Skills JavaScript Node SQL Projects '.repeat(5)
        return { text, confidence: 84, method: 'ocr', provider: 'mock' }
      },
      resolveDirectPdfVisionCapabilityFn: () => {
        counters.capability += 1
        return { supported: false }
      },
    },
  })
  assert.equal(result.methodUsed, 'ocr')
  assert.equal(result.stageDiagnostics.ocr.status, 'success')
  assert.equal(result.stageDiagnostics.direct_pdf_vision.status, 'skipped')
  assert.equal(result.attempts.length, 2)
  assert.deepEqual(counters, { extract: 1, ocr: 1, capability: 0 })
})

test('weak pdf_text + weak OCR + direct vision supported records direct vision stage and returns failed', async () => {
  const counters = { extract: 0, ocr: 0, capability: 0 }
  const result = await runParseWithOcrFallback({
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    fileSize: 8000,
    fileBuffer: Buffer.from('pdf'),
    dependencies: {
      extractTextFromResumeFn: async () => {
        counters.extract += 1
        return { text: '', method: 'pdf_text', length: 0 }
      },
      isLikelyScannedPdfFn: () => true,
      runOcrWithCacheFn: async () => {
        counters.ocr += 1
        return { text: '', confidence: 12, method: 'ocr', provider: 'mock' }
      },
      getActiveAiProviderCredentialsFn: async () => ({ provider: 'mock' }),
      resolveDirectPdfVisionCapabilityFn: () => {
        counters.capability += 1
        return { supported: true, attemptedProvider: 'mock', attemptedModel: 'vision-model' }
      },
    },
  })
  assert.equal(result.methodUsed, 'failed')
  assert.equal(result.stageDiagnostics.direct_pdf_vision.attempted, true)
  assert.equal(result.stageDiagnostics.direct_pdf_vision.status, 'failed')
  assert.equal(result.stageDiagnostics.direct_pdf_vision.reason, 'not_implemented_no_usable_upstream_text')
  assert.equal(result.attempts.length, 2)
  assert.deepEqual(counters, { extract: 1, ocr: 1, capability: 1 })
})

test('weak pdf_text + weak OCR + direct vision unsupported returns failed with diagnostics and no retry loops', async () => {
  const counters = { extract: 0, ocr: 0, capability: 0 }
  const result = await runParseWithOcrFallback({
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    fileSize: 8000,
    fileBuffer: Buffer.from('pdf'),
    dependencies: {
      extractTextFromResumeFn: async () => {
        counters.extract += 1
        return { text: '', method: 'pdf_text', length: 0 }
      },
      isLikelyScannedPdfFn: () => true,
      runOcrWithCacheFn: async () => {
        counters.ocr += 1
        return { text: '', confidence: 12, method: 'ocr', provider: 'mock' }
      },
      getActiveAiProviderCredentialsFn: async () => ({ provider: 'mock' }),
      resolveDirectPdfVisionCapabilityFn: () => {
        counters.capability += 1
        return { supported: false, activeProvider: 'mock', activeModel: 'text-only' }
      },
    },
  })
  assert.equal(result.methodUsed, 'failed')
  assert.equal(result.stageDiagnostics.direct_pdf_vision.attempted, false)
  assert.equal(result.stageDiagnostics.direct_pdf_vision.reason, 'unsupported_model_input_mode')
  assert.equal(result.stageDiagnostics.ocr.status, 'failed')
  assert.equal(result.attempts.length, 2)
  assert.deepEqual(counters, { extract: 1, ocr: 1, capability: 1 })
})
