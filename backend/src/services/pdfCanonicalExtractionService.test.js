import test from 'node:test'
import assert from 'node:assert/strict'

import {
  __resetPdfJsClientForTests,
  __setPdfJsClientForTests,
  observePdfCanonicalTextExtraction,
} from './pdfCanonicalExtractionService.js'
import {
  buildMissingTextPdfFixture,
  buildOverPageLimitPdfFixture,
  buildPdfJsTextContentMockFromFixtures,
  buildSyntheticPdfResumeFixture,
} from './resumeFormatDiagnosticFixtures.js'

function resetPdfJs(t) {
  t.after(() => __resetPdfJsClientForTests())
}

test('observePdfCanonicalTextExtraction returns dependency_error when pdfjs is unavailable', async (t) => {
  resetPdfJs(t)
  __setPdfJsClientForTests(null)
  const fixture = buildSyntheticPdfResumeFixture()
  const diagnostic = await observePdfCanonicalTextExtraction(fixture.buffer)

  assert.equal(diagnostic.success, false)
  assert.equal(diagnostic.failureCategory, 'dependency_error')
  assert.equal(diagnostic.qualityClassification, 'dependency_error')
  assert.match(diagnostic.errorFingerprint, /^[a-f0-9]{16}$/)
})

test('observePdfCanonicalTextExtraction returns file_too_large when above observe-only byte limit', async (t) => {
  resetPdfJs(t)
  const fixture = buildSyntheticPdfResumeFixture()
  __setPdfJsClientForTests(buildPdfJsTextContentMockFromFixtures([fixture]))
  const diagnostic = await observePdfCanonicalTextExtraction(fixture.buffer, {
    env: { PDF_CANONICAL_EXTRACTION_MAX_BYTES: '10' },
  })

  assert.equal(diagnostic.success, false)
  assert.equal(diagnostic.failureCategory, 'file_too_large')
  assert.equal(diagnostic.qualityClassification, 'file_too_large')
})

test('observePdfCanonicalTextExtraction returns malformed_pdf for invalid PDF bytes', async () => {
  const diagnostic = await observePdfCanonicalTextExtraction(Buffer.from('not a pdf'))

  assert.equal(diagnostic.success, false)
  assert.equal(diagnostic.failureCategory, 'malformed_pdf')
  assert.equal(diagnostic.qualityClassification, 'malformed_pdf')
})

test('observePdfCanonicalTextExtraction returns parser_timeout when pdfjs parse exceeds timeout', async (t) => {
  resetPdfJs(t)
  const fixture = buildSyntheticPdfResumeFixture()
  __setPdfJsClientForTests({
    version: '5.4.394-timeout-test',
    getDocument() {
      return {
        promise: new Promise(() => {}),
        destroy: () => {},
      }
    },
  })

  const diagnostic = await observePdfCanonicalTextExtraction(fixture.buffer, {
    env: { PDF_CANONICAL_EXTRACTION_TIMEOUT_MS: '5' },
  })

  assert.equal(diagnostic.success, false)
  assert.equal(diagnostic.failureCategory, 'parser_timeout')
  assert.equal(diagnostic.qualityClassification, 'parser_timeout')
})

test('observePdfCanonicalTextExtraction classifies missing selectable text as likely_scanned_pdf', async (t) => {
  resetPdfJs(t)
  const fixture = buildMissingTextPdfFixture()
  __setPdfJsClientForTests(buildPdfJsTextContentMockFromFixtures([fixture]))
  const diagnostic = await observePdfCanonicalTextExtraction(fixture.buffer)

  assert.equal(diagnostic.success, true)
  assert.equal(diagnostic.qualityClassification, 'likely_scanned_pdf')
  assert.equal(diagnostic.ocrRequired, true)
  assert.equal(diagnostic.normalizedFingerprint, null)
})

test('observePdfCanonicalTextExtraction reports capped pages and uses pagesRead for density', async (t) => {
  resetPdfJs(t)
  const fixture = buildOverPageLimitPdfFixture({ pageCount: 4 })
  __setPdfJsClientForTests(buildPdfJsTextContentMockFromFixtures([fixture]))
  const diagnostic = await observePdfCanonicalTextExtraction(fixture.buffer, {
    env: { PDF_CANONICAL_EXTRACTION_MAX_PAGES: '2' },
  })

  assert.equal(diagnostic.success, true)
  assert.equal(diagnostic.pageCount, 4)
  assert.equal(diagnostic.pagesRead, 2)
  assert.equal(diagnostic.observationTruncated, true)
  assert.equal(diagnostic.pageLimitReached, true)
  assert.equal(diagnostic.qualityClassification, 'usable_text_extraction')
  assert.match(diagnostic.normalizedFingerprint, /^[a-f0-9]{64}$/)
})
