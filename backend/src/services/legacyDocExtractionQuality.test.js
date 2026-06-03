import { Buffer } from 'node:buffer'
import process from 'node:process'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calculateLegacyDocExtractionQualityMetrics,
  evaluateLegacyDocExtractionQuality,
  measureExtractionQuality,
} from './legacyDocExtractionQuality.js'
import {
  extractTextFromLegacyDocBuffer,
  getLegacyDocExtractionLimits,
} from './legacyDocExtractionService.js'
import {
  __resetMammothClientForTests,
  __setMammothClientForTests,
  prepareResumePayloadForAnalysis,
} from './resumeDocumentExtractionService.js'
import {
  buildDocxControlFixture,
  buildPdfControlFixture,
  buildSameBasenameMixedFormatFixtures,
  buildTxtControlFixture,
  invalidLegacyDocFixtures,
  validLegacyDocFixtures,
} from './__fixtures__/legacyDocQualityFixtures.js'

const quietLogger = { debug() {}, info() {}, warn() {} }

function withLegacyDocFlag(t, value) {
  const previousFlag = process.env.ENABLE_LEGACY_DOC_EXTRACTION
  process.env.ENABLE_LEGACY_DOC_EXTRACTION = value
  t.after(() => {
    if (typeof previousFlag === 'undefined') delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
    else process.env.ENABLE_LEGACY_DOC_EXTRACTION = previousFlag
  })
}

test('legacy DOC extraction quality metrics reject noise, duplicated lines, and missing markers', () => {
  const text = 'Candidate Name\nCandidate Name\nSkills: Node.js\n\u0000\u0001'
  const metrics = calculateLegacyDocExtractionQualityMetrics({
    fixtureName: 'metric-smoke',
    extractedText: text,
    expectedMarkers: ['Candidate Name', 'Node.js', 'Missing School'],
    durationMs: 12.345,
  })
  const evaluation = evaluateLegacyDocExtractionQuality(metrics)

  assert.equal(metrics.fixtureName, 'metric-smoke')
  assert.equal(metrics.success, true)
  assert.equal(metrics.lineCount, 4)
  assert.equal(metrics.expectedMarkerCoveragePercent, 66.67)
  assert.equal(metrics.expectedMarkersFound, 2)
  assert.ok(metrics.duplicateLineRatio > 0)
  assert.ok(metrics.suspiciousBinaryNoiseRatio > 0)
  assert.equal(evaluation.passed, false)
  assert.equal(evaluation.checks.markerCoverage, false)
})

test('valid legacy DOC fixtures meet marker coverage and safety thresholds', async (t) => {
  withLegacyDocFlag(t, 'true')

  for (const fixture of validLegacyDocFixtures) {
    const measured = await measureExtractionQuality(fixture, ({ buffer, filename, mimeType }) => extractTextFromLegacyDocBuffer(buffer, {
      filename,
      mimeType,
      logger: quietLogger,
    }))
    const { metrics, evaluation } = measured

    assert.equal(metrics.success, true, `${fixture.name} should extract text`)
    assert.equal(metrics.expectedMarkerCoveragePercent, 100, `${fixture.name} should include all expected markers`)
    assert.equal(evaluation.passed, true, `${fixture.name} should meet quality thresholds`)
    assert.ok(metrics.extractedTextLength >= 80, `${fixture.name} should have useful length`)
    assert.ok(metrics.extractedTextLength <= 2000, `${fixture.name} should remain bounded`)
    assert.ok(metrics.printableCharacterRatio >= 0.95, `${fixture.name} should not contain binary garbage`)
    assert.ok(metrics.duplicateLineRatio <= 0.2, `${fixture.name} should not duplicate text excessively`)
    assert.ok(metrics.suspiciousBinaryNoiseRatio <= 0.02, `${fixture.name} should not contain suspicious binary noise`)
    assert.ok(metrics.lineCount >= 3, `${fixture.name} should preserve line structure`)
  }
})

test('valid legacy DOC fixtures prepare a text/plain extracted-text payload without provider binary input', async (t) => {
  withLegacyDocFlag(t, 'true')

  for (const fixture of validLegacyDocFixtures) {
    const result = await prepareResumePayloadForAnalysis({
      fileBufferBase64: fixture.buffer.toString('base64'),
      mimeType: fixture.mimeType,
      originalMimeType: fixture.mimeType,
      filename: fixture.filename,
      fileSize: fixture.buffer.length,
      logger: quietLogger,
    })

    assert.equal(result.mimeType, 'text/plain')
    assert.equal(result.preparedMimeType, 'text/plain')
    assert.equal(result.sourceFormat, 'doc')
    assert.equal(result.inputKind, 'extracted_text')
    assert.equal(result.inputMode, 'extracted_text')
    assert.equal(result.extractionMethod, 'legacy_doc_text_extraction')
    assert.equal(result.base64File, null)
    assert.equal(Buffer.from(result.fileBufferBase64, 'base64').toString('utf8'), result.extractedText)
    for (const marker of fixture.expectedMarkers) {
      assert.match(result.extractedText, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
    }
    assert.equal(result.diagnostics.preparedMimeType, 'text/plain')
    assert.equal(result.diagnostics.inputKind, 'extracted_text')
    assert.equal(result.diagnostics.sourceFormat, 'doc')
    assert.equal(result.diagnostics.extractionMethod, 'legacy_doc_text_extraction')
  }
})

test('invalid and unreadable legacy DOC fixtures fail deterministically with safe diagnostics', async (t) => {
  withLegacyDocFlag(t, 'true')

  for (const fixture of invalidLegacyDocFixtures) {
    await assert.rejects(
      () => prepareResumePayloadForAnalysis({
        fileBufferBase64: fixture.buffer.toString('base64'),
        mimeType: fixture.mimeType,
        originalMimeType: fixture.mimeType,
        filename: fixture.filename,
        fileSize: fixture.buffer.length,
        logger: quietLogger,
      }),
      (error) => {
        assert.equal(error.extractionCategory, fixture.expectedErrorCategory)
        assert.equal(error.nonRetriable, true)
        assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_text_extraction')
        assert.equal(error.diagnostics.preparedMimeType, null)
        assert.equal(error.diagnostics.inputKind, 'extracted_text')
        assert.equal(JSON.stringify(error.diagnostics).includes(fixture.filename), false)
        assert.match(error.message, /^legacy_doc_extraction_failed::/)
        return true
      },
    )
  }
})

test('legacy DOC remains rejected when feature flag is disabled', async () => {
  const previousFlag = process.env.ENABLE_LEGACY_DOC_EXTRACTION
  process.env.ENABLE_LEGACY_DOC_EXTRACTION = 'false'
  try {
    const fixture = validLegacyDocFixtures[0]
    await assert.rejects(
      () => prepareResumePayloadForAnalysis({
        fileBufferBase64: fixture.buffer.toString('base64'),
        mimeType: fixture.mimeType,
        originalMimeType: fixture.mimeType,
        filename: fixture.filename,
        fileSize: fixture.buffer.length,
        logger: quietLogger,
      }),
      (error) => {
        assert.equal(error.extractionCategory, 'resume_unsupported_legacy_doc')
        assert.equal(error.nonRetriable, true)
        assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_rejected')
        return true
      },
    )
  } finally {
    if (typeof previousFlag === 'undefined') delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
    else process.env.ENABLE_LEGACY_DOC_EXTRACTION = previousFlag
  }
})

test('legacy DOC extractor enforces conservative size and timeout limits', async () => {
  assert.deepEqual(getLegacyDocExtractionLimits({}), { maxBytes: 5 * 1024 * 1024, timeoutMs: 2000 })

  const tooLargeBuffer = Buffer.alloc(32, 0x41)
  await assert.rejects(
    () => extractTextFromLegacyDocBuffer(tooLargeBuffer, {
      filename: 'too-large.doc',
      mimeType: 'application/msword',
      env: { LEGACY_DOC_EXTRACTION_MAX_BYTES: '8' },
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^legacy_doc_extraction_failed::file_too_large$/)
      assert.equal(error.nonRetriable, true)
      assert.equal(error.diagnostics.errorCategory, 'file_too_large')
      return true
    },
  )

  await assert.rejects(
    () => extractTextFromLegacyDocBuffer(Buffer.alloc(20000, 0x41), {
      filename: 'timeout.doc',
      mimeType: 'application/msword',
      env: { LEGACY_DOC_EXTRACTION_TIMEOUT_MS: '1' },
      logger: quietLogger,
    }),
    /legacy_doc_extraction_failed::extraction_timeout|legacy_doc_extraction_failed::empty_extracted_text/,
  )
})

test('control fixtures route through existing PDF, DOCX, and TXT paths without legacy DOC behavior', async (t) => {
  const docxControl = await buildDocxControlFixture()
  const pdfControl = buildPdfControlFixture()
  const txtControl = buildTxtControlFixture()
  const mammothCalls = []
  __setMammothClientForTests({
    async extractRawText(input) {
      mammothCalls.push(input)
      return { value: 'Control DOCX Candidate with Mammoth extraction path.' }
    },
  })
  t.after(() => __resetMammothClientForTests())

  const pdfResult = await prepareResumePayloadForAnalysis({
    fileBufferBase64: pdfControl.buffer.toString('base64'),
    mimeType: pdfControl.mimeType,
    filename: pdfControl.filename,
    fileSize: pdfControl.buffer.length,
    logger: quietLogger,
  })
  const docxResult = await prepareResumePayloadForAnalysis({
    fileBufferBase64: docxControl.buffer.toString('base64'),
    mimeType: docxControl.mimeType,
    filename: docxControl.filename,
    fileSize: docxControl.buffer.length,
    logger: quietLogger,
  })
  const txtResult = await prepareResumePayloadForAnalysis({
    fileBufferBase64: txtControl.buffer.toString('base64'),
    mimeType: txtControl.mimeType,
    filename: txtControl.filename,
    fileSize: txtControl.buffer.length,
    logger: quietLogger,
  })

  assert.equal(pdfResult.sourceFormat, 'pdf')
  assert.equal(pdfResult.inputKind, 'pdf_binary')
  assert.equal(pdfResult.extractionMethod, undefined)
  assert.equal(pdfResult.diagnostics.extractionMethod, 'pdf_binary_provider_input')
  assert.equal(docxResult.sourceFormat, 'docx')
  assert.equal(docxResult.inputKind, 'extracted_text')
  assert.equal(docxResult.diagnostics.extractionMethod, 'docx_mammoth_text_extraction')
  assert.equal(mammothCalls.length, 1)
  assert.equal(txtResult.sourceFormat, 'txt')
  assert.equal(txtResult.inputKind, 'extracted_text')
  assert.equal(txtResult.diagnostics.extractionMethod, 'text_plain_extraction')
})

test('same-basename PDF, DOC, and DOCX remain distinct and route independently when legacy DOC is enabled', async (t) => {
  withLegacyDocFlag(t, 'true')
  const docxControl = await buildDocxControlFixture()
  const fixtures = buildSameBasenameMixedFormatFixtures({ docxBuffer: docxControl.buffer })
  const mammothCalls = []
  __setMammothClientForTests({
    async extractRawText(input) {
      mammothCalls.push(input)
      return { value: 'Same basename DOCX extracted by Mammoth.' }
    },
  })
  t.after(() => __resetMammothClientForTests())

  const results = []
  for (const fixture of fixtures) {
    results.push(await prepareResumePayloadForAnalysis({
      fileBufferBase64: fixture.buffer.toString('base64'),
      mimeType: fixture.mimeType,
      originalMimeType: fixture.mimeType,
      filename: fixture.filename,
      fileSize: fixture.buffer.length,
      logger: quietLogger,
    }))
  }

  assert.deepEqual(fixtures.map((fixture) => fixture.filename), ['resume.pdf', 'resume.doc', 'resume.docx'])
  assert.deepEqual(results.map((result) => result.sourceFormat), ['pdf', 'doc', 'docx'])
  assert.deepEqual(results.map((result) => result.originalFilename), ['resume.pdf', 'resume.doc', 'resume.docx'])
  assert.equal(results[0].diagnostics.extractionMethod, 'pdf_binary_provider_input')
  assert.equal(results[1].diagnostics.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(results[2].diagnostics.extractionMethod, 'docx_mammoth_text_extraction')
  assert.equal(results[1].base64File, null)
  assert.equal(mammothCalls.length, 1)
})
