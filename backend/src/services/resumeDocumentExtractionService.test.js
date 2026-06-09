import { Buffer } from 'node:buffer'
import process from 'node:process'
import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

import {
  __resetMammothClientForTests,
  __setMammothClientForTests,
  buildSafeResumeFileDiagnostics,
  classifyResumeFileMagic,
  compareResumeTextFingerprints,
  inspectDocxBuffer,
  logSafeResumeFileDiagnostics,
  prepareResumePayloadForAnalysis,
} from './resumeDocumentExtractionService.js'
import { buildSyntheticPdfResumeFixture, buildMissingTextPdfFixture, buildMalformedPdfFixture, buildPdfJsTextContentMockFromFixtures } from './resumeFormatDiagnosticFixtures.js'
import {
  __resetPdfJsClientForTests,
  __setPdfJsClientForTests,
  evaluatePdfCanonicalExtractionObserveOnlyEligibility,
} from './pdfCanonicalExtractionService.js'
import { UNSUPPORTED_LEGACY_WORD_MESSAGE } from '../utils/legacyWordDocument.js'

async function buildDocxBuffer(paragraphs = [], tableRows = []) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`)

  const paragraphXml = paragraphs.map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`).join('')
  const tableXml = tableRows.length > 0
    ? `<w:tbl>${tableRows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
    : ''

  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphXml}${tableXml}<w:sectPr/></w:body>
</w:document>`)

  return zip.generateAsync({ type: 'nodebuffer' })
}

async function buildZipMissingDocumentXmlBuffer() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types/>')
  zip.folder('word').file('styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles/>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

const quietLogger = {
  debug() {},
  info() {},
  warn() {},
}

function withPdfObserveOnlyEnv(overrides = {}) {
  const keys = [
    'PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED',
    'PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE',
    'PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS',
    'PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS',
  ]
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value
  }
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    __resetPdfJsClientForTests()
  }
}

async function preparePdfWithCountingParser(env, diagnosticsContext = {}) {
  const fixture = buildSyntheticPdfResumeFixture()
  let parserCalls = 0
  const mock = buildPdfJsTextContentMockFromFixtures([fixture, fixture, fixture])
  __setPdfJsClientForTests({
    ...mock,
    getDocument(...args) {
      parserCalls += 1
      return mock.getDocument(...args)
    },
  })
  const restore = withPdfObserveOnlyEnv(env)
  try {
    const result = await prepareResumePayloadForAnalysis({
      fileBufferBase64: fixture.buffer.toString('base64'),
      mimeType: 'application/pdf',
      filename: fixture.filename,
      fileSize: fixture.buffer.length,
      logger: quietLogger,
      diagnosticsContext,
    })
    return { result, parserCalls, fixture }
  } finally {
    restore()
  }
}



test('classifyResumeFileMagic identifies PDF, DOCX zip, legacy DOC OLE, and unknown buffers', async () => {
  const pdfBuffer = Buffer.from('%PDF-1.7\nbody')
  const docxBuffer = await buildDocxBuffer(['Jane Doe'], [])
  const oleDocBuffer = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from('legacy-doc-body'),
  ])
  const unknownBuffer = Buffer.from('not a recognized document')

  assert.deepEqual(classifyResumeFileMagic(pdfBuffer), {
    classification: 'pdf',
    hasWordDocumentXml: false,
  })
  assert.deepEqual(classifyResumeFileMagic(docxBuffer), {
    classification: 'docx_zip',
    hasWordDocumentXml: true,
  })
  assert.deepEqual(classifyResumeFileMagic(oleDocBuffer), {
    classification: 'legacy_doc_ole',
    hasWordDocumentXml: false,
  })
  assert.deepEqual(classifyResumeFileMagic(unknownBuffer), {
    classification: 'unknown',
    hasWordDocumentXml: false,
  })
})

test('safe resume file diagnostics omit content, base64, and raw filenames while preserving file identity fingerprints', async () => {
  const docxBuffer = await buildDocxBuffer(['Private Candidate Name'], [])
  const diagnostics = buildSafeResumeFileDiagnostics({
    resumeId: 'resume-123',
    analysisId: 'analysis-456',
    parseJobId: 'resume:resume-123',
    originalFilename: 'candidate.docx',
    displayFilename: 'candidate_upload.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    originalMimeType: 'application/octet-stream',
    normalizedMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: docxBuffer.length,
    fileBuffer: docxBuffer,
    extension: 'docx',
    extractionMethod: 'docx_mammoth_text_extraction',
    extractedTextCharCount: 23,
    preparedMimeType: 'text/plain',
    inputKind: 'extracted_text',
  })
  const serialized = JSON.stringify(diagnostics)

  assert.equal(diagnostics.resumeId, 'resume-123')
  assert.equal(diagnostics.analysisId, 'analysis-456')
  assert.equal(diagnostics.parseJobId, 'resume:resume-123')
  assert.match(diagnostics.originalFilenameFingerprint, /^[a-f0-9]{16}$/)
  assert.match(diagnostics.displayFilenameFingerprint, /^[a-f0-9]{16}$/)
  assert.match(diagnostics.fileContentFingerprint, /^[a-f0-9]{16}$/)
  assert.notEqual(diagnostics.originalFilenameFingerprint, diagnostics.displayFilenameFingerprint)
  assert.equal(diagnostics.extension, 'docx')
  assert.equal(diagnostics.fileSignature, 'docx_zip')
  assert.equal(diagnostics.hasWordDocumentXml, true)
  assert.equal(serialized.includes('Private Candidate Name'), false)
  assert.equal(serialized.includes('candidate.docx'), false)
  assert.equal(serialized.includes('candidate_upload.docx'), false)
  assert.equal(serialized.includes('base64'), false)
  assert.equal(serialized.includes('content'), false)
})

test('safe resume file diagnostics logger strips raw filename fields from legacy diagnostic objects', () => {
  const logged = []
  const logger = {
    info(message, payload) {
      logged.push({ message, payload })
    },
  }

  logSafeResumeFileDiagnostics(logger, 'parse_job_input', {
    resumeId: 'resume-123',
    originalFilename: 'Jane_Doe_Resume.pdf',
    displayFilename: 'Jane_Doe_Upload.pdf',
    uploadMimeType: 'application/pdf',
    extension: 'pdf',
  })

  assert.equal(logged.length, 1)
  assert.equal(logged[0].message, '[ResumeDiagnostics] parse_job_input')
  assert.equal(logged[0].payload.originalFilename, undefined)
  assert.equal(logged[0].payload.displayFilename, undefined)
  assert.match(logged[0].payload.originalFilenameFingerprint, /^[a-f0-9]{16}$/)
  assert.match(logged[0].payload.displayFilenameFingerprint, /^[a-f0-9]{16}$/)
  assert.equal(logged[0].payload.extension, 'pdf')
  assert.equal(JSON.stringify(logged[0].payload).includes('Jane_Doe'), false)
})

test('compareResumeTextFingerprints identifies equivalent extracted resume text without exposing content', () => {
  const left = 'Resume\nPriya Nair\nQA Automation Engineer\nPage 1 of 2\nPlaywright   regression automation'
  const right = '  priya nair  \nqa automation engineer\nplaywright regression automation\n'
  const comparison = compareResumeTextFingerprints(left, right)

  assert.equal(comparison.comparable, true)
  assert.equal(comparison.equivalent, true)
  assert.equal(comparison.left.normalizedTextCharCount, comparison.right.normalizedTextCharCount)
  assert.equal(JSON.stringify(comparison).includes('Priya'), false)
})


test('PDF observe-only rollout master flag defaults off and false prevents parser execution', async () => {
  let run = await preparePdfWithCountingParser({}, { userId: '26', analysisId: 'analysis-id-1', resumeId: 'resume-1' })
  assert.equal(run.parserCalls, 0)
  assert.equal(run.result.diagnostics.observeOnlyEligibility.masterEnabled, false)
  assert.equal(run.result.diagnostics.observeOnlyEligibility.eligibilityReason, 'master_disabled')
  assert.equal(run.result.diagnostics.pdfCanonicalExtractionObserveOnly.enabled, false)

  run = await preparePdfWithCountingParser({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'false',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: '26',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '100',
  }, { userId: '26', resumeId: 'resume-1' })
  assert.equal(run.parserCalls, 0)
  assert.equal(run.result.diagnostics.observeOnlyEligibility.masterEnabled, false)
  assert.equal(run.result.diagnostics.observeOnlyEligibility.eligible, false)
})

test('PDF observe-only rollout requires allowlist when sample rate is zero', async () => {
  const blocked = await preparePdfWithCountingParser({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: ' 26, 41 ',
  }, { userId: '99', resumeId: 'resume-2' })
  assert.equal(blocked.parserCalls, 0)
  assert.equal(blocked.result.diagnostics.observeOnlyEligibility.eligibilityReason, 'not_selected')
  assert.equal(blocked.result.diagnostics.observeOnlyEligibility.allowlistMatched, false)

  const allowed = await preparePdfWithCountingParser({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: ' 26, 41 ',
  }, { userId: '41', resumeId: 'resume-3' })
  assert.equal(allowed.parserCalls, 1)
  assert.equal(allowed.result.diagnostics.observeOnlyEligibility.eligible, true)
  assert.equal(allowed.result.diagnostics.observeOnlyEligibility.eligibilityReason, 'user_allowlist')
  assert.equal(allowed.result.diagnostics.observeOnlyEligibility.matchedAllowlistType, 'user_id')

  const emptyAllowlist = await preparePdfWithCountingParser({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: ' , , ',
  }, { userId: '41', resumeId: 'resume-4' })
  assert.equal(emptyAllowlist.parserCalls, 0)
})

test('PDF observe-only rollout supports analysis allowlist without user allowlist', async () => {
  const allowed = await preparePdfWithCountingParser({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS: 'analysis-id-1, analysis-id-2',
  }, { userId: '99', analysisId: 'analysis-id-2', resumeId: 'resume-5' })
  assert.equal(allowed.parserCalls, 1)
  assert.equal(allowed.result.diagnostics.observeOnlyEligibility.eligibilityReason, 'analysis_allowlist')
  assert.equal(allowed.result.diagnostics.observeOnlyEligibility.matchedAllowlistType, 'analysis_id')

  const blocked = await preparePdfWithCountingParser({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS: 'analysis-id-1, analysis-id-2',
  }, { userId: '99', analysisId: 'analysis-id-3', resumeId: 'resume-6' })
  assert.equal(blocked.parserCalls, 0)
  assert.equal(blocked.result.diagnostics.observeOnlyEligibility.eligibilityReason, 'not_selected')
})

test('PDF observe-only deterministic sampling is bounded, stable, and does not use randomness', () => {
  const base = {
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: '',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS: '',
  }
  assert.equal(evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0' }, fileContentFingerprint: 'file-fp-1' }).sampled, false)
  assert.equal(evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '100' }, fileContentFingerprint: 'file-fp-1' }).sampled, true)
  assert.equal(evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: 'invalid' }, fileContentFingerprint: 'file-fp-1' }).sampleRate, 0)
  assert.equal(evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '-1' }, fileContentFingerprint: 'file-fp-1' }).sampleRate, 0)
  assert.equal(evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '250' }, fileContentFingerprint: 'file-fp-1' }).sampleRate, 100)

  const first = evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '5' }, fileContentFingerprint: 'file-fp-1' })
  const second = evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '5' }, fileContentFingerprint: 'file-fp-1' })
  const different = evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '5' }, fileContentFingerprint: 'file-fp-2' })
  assert.equal(first.samplingBucket, second.samplingBucket)
  assert.equal(first.sampled, second.sampled)
  assert.notEqual(first.samplingBucket, different.samplingBucket)
})

test('PDF observe-only parser failure is diagnostic-only and does not expose unsafe metadata', async () => {
  let parserCalls = 0
  __setPdfJsClientForTests({
    version: 'failure-mock',
    getDocument() {
      parserCalls += 1
      throw new Error('synthetic parser failure containing Jane Doe jane@example.com 555-0100 resume.pdf')
    },
  })
  const restore = withPdfObserveOnlyEnv({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: '26',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
  })
  try {
    const payload = Buffer.from('%PDF-1.7 fake pdf bytes').toString('base64')
    const result = await prepareResumePayloadForAnalysis({
      fileBufferBase64: payload,
      mimeType: 'application/pdf',
      filename: 'Jane_Doe_resume.pdf',
      fileSize: Buffer.from('%PDF-1.7 fake pdf bytes').length,
      logger: quietLogger,
      diagnosticsContext: { userId: '26', resumeId: 'resume-7' },
    })
    assert.equal(parserCalls, 1)
    assert.equal(result.fileBufferBase64, payload)
    assert.equal(result.base64File, payload)
    assert.equal(result.extractedText, null)
    assert.equal(result.diagnostics.pdfCanonicalExtractionObserveOnly.success, false)
    const serialized = JSON.stringify(result.diagnostics)
    assert.equal(serialized.includes('Jane_Doe'), false)
    assert.equal(serialized.includes('jane@example.com'), false)
    assert.equal(serialized.includes('555-0100'), false)
    assert.equal(serialized.includes(payload), false)
  } finally {
    restore()
  }
})

test('prepareResumePayloadForAnalysis keeps PDF payload unchanged', async () => {
  const payload = Buffer.from('%PDF-1.7 fake pdf bytes').toString('base64')
  const result = await prepareResumePayloadForAnalysis({
    fileBufferBase64: payload,
    mimeType: 'application/pdf',
    filename: 'resume.pdf',
    fileSize: Buffer.from('%PDF-1.7 fake pdf bytes').length,
  })

  assert.equal(result.fileBufferBase64, payload)
  assert.equal(result.mimeType, 'application/pdf')
  assert.equal(result.preparedMimeType, 'application/pdf')
  assert.equal(result.inputKind, 'pdf_binary')
  assert.equal(result.inputMode, 'binary')
  assert.equal(result.diagnostics.sourceFormat, 'pdf')
  assert.equal(result.diagnostics.extractionMethod, 'pdf_binary_provider_input')
  assert.equal(result.diagnostics.extractedTextCharCount, 0)
  assert.equal(result.diagnostics.normalizedTextFingerprint, null)
  assert.equal(result.diagnostics.fileSignature, 'pdf')
  assert.equal(result.diagnostics.preparedMimeType, 'application/pdf')
  assert.equal(result.diagnostics.inputKind, 'pdf_binary')
})

test('prepareResumePayloadForAnalysis extracts selectable text from a valid DOCX with paragraphs and a table', async () => {
  const docxBuffer = await buildDocxBuffer(
    ['Priya Nair', 'QA Automation Engineer transitioning into AI recruiting workflows.'],
    [['Skill', 'Evidence'], ['Playwright', 'Built regression automation suites']],
  )

  const result = await prepareResumePayloadForAnalysis({
    fileBufferBase64: docxBuffer.toString('base64'),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filename: '05_Priya_Nair_QA_Automation_Transition_Resume.docx',
    fileSize: docxBuffer.length,
    logger: quietLogger,
  })

  assert.equal(result.preparedMimeType, 'text/plain')
  assert.equal(result.mimeType, 'text/plain')
  assert.equal(result.inputKind, 'extracted_text')
  assert.equal(result.inputMode, 'extracted_text')
  assert.ok(result.extractedText.length > 0)
  assert.match(result.extractedText, /Priya Nair/)
  assert.match(result.extractedText, /QA Automation Engineer/)
  assert.match(result.extractedText, /Playwright/)
  assert.equal(Buffer.from(result.fileBufferBase64, 'base64').toString('utf8'), result.extractedText)
  assert.equal(result.diagnostics.sourceFormat, 'docx')
  assert.equal(result.diagnostics.extractionMethod, 'docx_mammoth_text_extraction')
  assert.equal(result.diagnostics.extractedTextCharCount, result.extractedText.length)
  assert.equal(typeof result.diagnostics.normalizedTextFingerprint, 'string')
  assert.equal(result.diagnostics.fileSignature, 'docx_zip')
  assert.equal(result.diagnostics.hasWordDocumentXml, true)
  assert.equal(result.diagnostics.preparedMimeType, 'text/plain')
  assert.equal(result.diagnostics.inputKind, 'extracted_text')
})

test('prepareResumePayloadForAnalysis accepts octet-stream DOCX via extension fallback path', async () => {
  const docxBuffer = await buildDocxBuffer(['Priya Nair'], [['Role', 'QA Automation']])
  const result = await prepareResumePayloadForAnalysis({
    fileBufferBase64: docxBuffer.toString('base64'),
    mimeType: 'application/octet-stream',
    filename: 'resume.docx',
    fileSize: docxBuffer.length,
    logger: quietLogger,
  })

  assert.equal(result.preparedMimeType, 'text/plain')
  assert.equal(result.sourceFormat, 'docx')
  assert.match(result.extractedText, /Priya Nair/)
})

test('prepareResumePayloadForAnalysis fails invalid DOCX with deterministic invalid/unreadable category', async () => {
  const fakeDocxBuffer = Buffer.from('not-a-real-docx')
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: fakeDocxBuffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'resume.docx',
      fileSize: fakeDocxBuffer.length,
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^docx_invalid_or_unreadable::/)
      assert.equal(error.diagnostics.decodedBufferByteLength, fakeDocxBuffer.length)
      assert.equal(error.diagnostics.hasDocxZipMagic, false)
      assert.equal(error.diagnostics.hasWordDocumentXml, false)
      assert.equal(error.diagnostics.extractionMethod, 'docx_mammoth_text_extraction')
      assert.equal(error.diagnostics.originalFilename, undefined)
      assert.match(error.diagnostics.originalFilenameFingerprint, /^[a-f0-9]{16}$/)
      assert.equal(JSON.stringify(error.diagnostics).includes('resume.docx'), false)
      return true
    },
  )
})



test('prepareResumePayloadForAnalysis fails corrupt ZIP-like DOCX with invalid/unreadable category', async () => {
  const corruptDocxBuffer = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('word/document.xml present but zip central directory is corrupt'),
  ])

  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: corruptDocxBuffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'resume.docx',
      fileSize: corruptDocxBuffer.length,
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^docx_invalid_or_unreadable::/)
      assert.equal(error.diagnostics.hasDocxZipMagic, true)
      assert.equal(error.diagnostics.hasWordDocumentXml, true)
      assert.equal(error.cause instanceof Error, true)
      assert.match(error.diagnostics.cause.messageFingerprint, /^[a-f0-9]{16}$/)
      return true
    },
  )
})

test('prepareResumePayloadForAnalysis fails ZIP missing word/document.xml with invalid/unreadable category', async () => {
  const zipBuffer = await buildZipMissingDocumentXmlBuffer()
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: zipBuffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'resume.docx',
      fileSize: zipBuffer.length,
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^docx_invalid_or_unreadable::/)
      assert.equal(error.diagnostics.hasDocxZipMagic, true)
      assert.equal(error.diagnostics.hasWordDocumentXml, false)
      assert.equal(error.diagnostics.extractionMethod, 'docx_mammoth_text_extraction')
      assert.equal(error.cause, undefined)
      return true
    },
  )
})

test('prepareResumePayloadForAnalysis maps Mammoth unexpected runtime failure to extraction_failed with sanitized cause metadata', async (t) => {
  const docxBuffer = await buildDocxBuffer(['Priya Nair'], [])
  const originalError = new Error('simulated mammoth runtime failure for private resume text Priya Nair')
  originalError.code = 'SIMULATED_RUNTIME'
  __setMammothClientForTests({
    async extractRawText() {
      throw originalError
    },
  })
  t.after(() => __resetMammothClientForTests())

  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: docxBuffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'resume.docx',
      fileSize: docxBuffer.length,
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^docx_extraction_failed::/)
      assert.equal(error.cause, originalError)
      assert.equal(error.diagnostics.errorCategory, 'docx_extraction_failed')
      assert.equal(error.diagnostics.cause.name, 'Error')
      assert.equal(error.diagnostics.cause.code, 'SIMULATED_RUNTIME')
      assert.match(error.diagnostics.cause.messageFingerprint, /^[a-f0-9]{16}$/)
      assert.equal(JSON.stringify(error.diagnostics).includes('Priya Nair'), false)
      assert.equal(JSON.stringify(error.diagnostics).includes('private resume text'), false)
      return true
    },
  )
})

test('prepareResumePayloadForAnalysis maps Mammoth dependency/runtime shape issues to dependency_missing', async (t) => {
  const docxBuffer = await buildDocxBuffer(['Priya Nair'], [])
  __setMammothClientForTests(null)
  t.after(() => __resetMammothClientForTests())

  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: docxBuffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'resume.docx',
      fileSize: docxBuffer.length,
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^docx_dependency_missing::/)
      assert.equal(error.diagnostics.errorCategory, 'docx_dependency_missing')
      assert.equal(error.diagnostics.hasDocxZipMagic, true)
      assert.equal(error.diagnostics.hasWordDocumentXml, true)
      return true
    },
  )
})

test('prepareResumePayloadForAnalysis fails DOCX missing readable text with empty extraction category', async () => {
  const docxBuffer = await buildDocxBuffer([], [])
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: docxBuffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'empty.docx',
      fileSize: docxBuffer.length,
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^docx_empty_extraction::/)
      assert.equal(error.diagnostics.hasDocxZipMagic, true)
      assert.equal(error.diagnostics.hasWordDocumentXml, true)
      assert.equal(error.diagnostics.mammothTextLength, 0)
      assert.equal(error.diagnostics.extractionMethod, 'docx_mammoth_text_extraction')
      assert.equal(error.diagnostics.fileSignature, 'docx_zip')
      return true
    },
  )
})

test('inspectDocxBuffer reports zip signature and document XML without exposing content', async () => {
  const docxBuffer = await buildDocxBuffer(['Priya Nair'], [['Skill', 'Testing']])
  const diagnostics = inspectDocxBuffer(docxBuffer, {
    filename: 'resume.docx',
    mimeType: 'application/octet-stream',
    fileSize: docxBuffer.length,
  })

  assert.equal(diagnostics.filename, undefined)
  assert.equal(diagnostics.filenameExtension, 'docx')
  assert.match(diagnostics.filenameFingerprint, /^[a-f0-9]{16}$/)
  assert.equal(diagnostics.mimeType, 'application/octet-stream')
  assert.equal(diagnostics.declaredFileSize, docxBuffer.length)
  assert.equal(diagnostics.decodedBufferByteLength, docxBuffer.length)
  assert.equal(diagnostics.hasDocxZipMagic, true)
  assert.equal(diagnostics.hasWordDocumentXml, true)
  assert.equal(JSON.stringify(diagnostics).includes('Priya'), false)
  assert.equal(JSON.stringify(diagnostics).includes('resume.docx'), false)
})

test('prepareResumePayloadForAnalysis fails .doc filename with application/msword as unsupported legacy DOC', async () => {
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: Buffer.from('legacy').toString('base64'),
      mimeType: 'application/msword',
      filename: 'resume.doc',
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^resume_unsupported_legacy_doc::/)
      assert.equal(error.message, `resume_unsupported_legacy_doc::${UNSUPPORTED_LEGACY_WORD_MESSAGE}`)
      assert.equal(error.nonRetriable, true)
      assert.equal(error.diagnostics.hasDocExtension, true)
      assert.equal(error.diagnostics.hasLegacyMimeType, true)
      assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_rejected')
      assert.equal(error.diagnostics.fileSignature, 'unknown')
      return true
    },
  )
})

test('prepareResumePayloadForAnalysis fails uppercase .DOC as unsupported legacy DOC', async () => {
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: Buffer.from('legacy').toString('base64'),
      mimeType: 'application/octet-stream',
      filename: 'RESUME.DOC',
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^resume_unsupported_legacy_doc::/)
      assert.equal(error.diagnostics.extension, 'doc')
      assert.equal(error.diagnostics.hasDocExtension, true)
      return true
    },
  )
})

test('prepareResumePayloadForAnalysis fails extensionless application/msword as unsupported legacy DOC', async () => {
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: Buffer.from('legacy').toString('base64'),
      mimeType: 'application/msword',
      filename: 'resume',
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^resume_unsupported_legacy_doc::/)
      assert.equal(error.diagnostics.extension, null)
      assert.equal(error.diagnostics.hasLegacyMimeType, true)
      assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_rejected')
      assert.equal(error.diagnostics.fileSignature, 'unknown')
      return true
    },
  )
})

test('prepareResumePayloadForAnalysis fails OLE compound legacy DOC before Mammoth DOCX extraction', async () => {
  const oleDocBuffer = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from('legacy-doc-body'),
  ])

  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: oleDocBuffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalMimeType: 'application/msword',
      filename: 'resume.docx',
      fileSize: oleDocBuffer.length,
      logger: quietLogger,
    }),
    (error) => {
      assert.match(error.message, /^resume_unsupported_legacy_doc::/)
      assert.equal(error.diagnostics.hasOleMagic, true)
      assert.equal(error.diagnostics.hasMismatch, true)
      assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_rejected')
      assert.equal(error.diagnostics.fileSignature, 'legacy_doc_ole')
      assert.doesNotMatch(error.message, /docx_empty_extraction/)
      return true
    },
  )
})


test('prepareResumePayloadForAnalysis keeps extractable legacy DOC unsupported when legacy extraction flag is off by default', async () => {
  const previousFlag = process.env.ENABLE_LEGACY_DOC_EXTRACTION
  delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
  const extractedDocText = 'Jane Default Flag Off\nLegacy DOC Candidate'
  const oleDocBuffer = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from(extractedDocText, 'utf16le'),
  ])

  try {
    await assert.rejects(
      () => prepareResumePayloadForAnalysis({
        fileBufferBase64: oleDocBuffer.toString('base64'),
        mimeType: 'application/msword',
        filename: 'resume.doc',
        fileSize: oleDocBuffer.length,
        logger: quietLogger,
      }),
      (error) => {
        assert.match(error.message, /^resume_unsupported_legacy_doc::/)
        assert.equal(error.nonRetriable, true)
        assert.equal(error.extractionCategory, 'resume_unsupported_legacy_doc')
        assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_rejected')
        assert.equal(error.diagnostics.preparedMimeType, null)
        assert.equal(error.diagnostics.inputKind, null)
        assert.equal(error.diagnostics.fileSignature, 'legacy_doc_ole')
        assert.equal(JSON.stringify(error.diagnostics).includes(extractedDocText), false)
        return true
      },
    )
  } finally {
    if (typeof previousFlag === 'undefined') delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
    else process.env.ENABLE_LEGACY_DOC_EXTRACTION = previousFlag
  }
})

test('prepareResumePayloadForAnalysis extracts enabled legacy DOC locally as text/plain without Mammoth', async () => {
  const previousFlag = process.env.ENABLE_LEGACY_DOC_EXTRACTION
  process.env.ENABLE_LEGACY_DOC_EXTRACTION = 'true'
  let mammothCalled = false
  __setMammothClientForTests({
    async extractRawText() {
      mammothCalled = true
      throw new Error('mammoth_should_not_be_called_for_doc')
    },
  })

  const extractedDocText = 'Jane Legacy\nSenior DOC Engineer'
  const oleDocBuffer = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from(extractedDocText, 'utf16le'),
  ])

  try {
    const result = await prepareResumePayloadForAnalysis({
      fileBufferBase64: oleDocBuffer.toString('base64'),
      mimeType: 'application/msword',
      filename: 'resume.doc',
      fileSize: oleDocBuffer.length,
      logger: quietLogger,
    })

    assert.equal(mammothCalled, false)
    assert.equal(result.mimeType, 'text/plain')
    assert.equal(result.preparedMimeType, 'text/plain')
    assert.equal(result.sourceFormat, 'doc')
    assert.equal(result.inputKind, 'extracted_text')
    assert.equal(result.inputMode, 'extracted_text')
    assert.equal(result.extractionMethod, 'legacy_doc_text_extraction')
    assert.equal(result.extractedText, extractedDocText)
    assert.equal(result.base64File, null)
    assert.equal(result.fileBufferBase64, Buffer.from(extractedDocText, 'utf8').toString('base64'))
    assert.equal(result.diagnostics.extractionMethod, 'legacy_doc_text_extraction')
    assert.equal(result.diagnostics.preparedMimeType, 'text/plain')
    assert.equal(result.diagnostics.inputKind, 'extracted_text')
    assert.equal(result.diagnostics.fileSignature, 'legacy_doc_ole')
  } finally {
    __resetMammothClientForTests()
    if (typeof previousFlag === 'undefined') delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
    else process.env.ENABLE_LEGACY_DOC_EXTRACTION = previousFlag
  }
})

test('prepareResumePayloadForAnalysis wraps enabled legacy DOC extraction failures as non-retriable local errors', async () => {
  const previousFlag = process.env.ENABLE_LEGACY_DOC_EXTRACTION
  process.env.ENABLE_LEGACY_DOC_EXTRACTION = 'true'
  const oleDocBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x01])

  try {
    await assert.rejects(
      () => prepareResumePayloadForAnalysis({
        fileBufferBase64: oleDocBuffer.toString('base64'),
        mimeType: 'application/msword',
        filename: 'resume.doc',
        logger: quietLogger,
      }),
      (error) => {
        assert.match(error.message, /^legacy_doc_extraction_failed::empty_extracted_text$/)
        assert.equal(error.nonRetriable, true)
        assert.equal(error.extractionCategory, 'legacy_doc_extraction_failed')
        assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_text_extraction')
        assert.equal(error.diagnostics.inputKind, 'extracted_text')
        assert.equal(error.diagnostics.preparedMimeType, null)
        assert.equal(error.diagnostics.fileSignature, 'legacy_doc_ole')
        return true
      },
    )
  } finally {
    if (typeof previousFlag === 'undefined') delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
    else process.env.ENABLE_LEGACY_DOC_EXTRACTION = previousFlag
  }
})

test('prepareResumePayloadForAnalysis normalizes text/plain into extracted_text with original mime preserved', async () => {
  const text = 'Jane Doe\nSenior Engineer'
  const result = await prepareResumePayloadForAnalysis({
    fileBufferBase64: Buffer.from(text, 'utf8').toString('base64'),
    mimeType: 'text/plain',
    filename: 'resume.txt',
  })

  assert.equal(result.originalMimeType, 'text/plain')
  assert.equal(result.preparedMimeType, 'text/plain')
  assert.equal(result.inputKind, 'extracted_text')
  assert.equal(result.inputMode, 'extracted_text')
  assert.equal(result.extractedText, text)
  assert.equal(result.diagnostics.extractionMethod, 'text_plain_extraction')
  assert.equal(result.diagnostics.extractedTextCharCount, text.length)
})


test('prepareResumePayloadForAnalysis runs PDF observe-only extraction behind feature flag without changing scoring payload', async () => {
  const restoreEnv = withPdfObserveOnlyEnv({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '100',
  })
  const logged = []
  const logger = {
    info(message, payload) { logged.push({ level: 'info', message, payload }) },
    warn(message, payload) { logged.push({ level: 'warn', message, payload }) },
    debug() {},
  }
  try {
    const fixture = buildSyntheticPdfResumeFixture()
    __setPdfJsClientForTests(buildPdfJsTextContentMockFromFixtures([fixture]))
    assert.equal(fixture.buffer.includes(Buffer.from('/FlateDecode')), true)
    assert.equal(fixture.buffer.includes(Buffer.from('Synthetic Candidate Alpha')), false)
    const payload = fixture.buffer.toString('base64')
    const result = await prepareResumePayloadForAnalysis({
      fileBufferBase64: payload,
      mimeType: 'application/pdf',
      filename: 'resume.pdf',
      fileSize: fixture.buffer.length,
      logger,
    })

    assert.equal(result.fileBufferBase64, payload)
    assert.equal(result.preparedMimeType, 'application/pdf')
    assert.equal(result.inputKind, 'pdf_binary')
    assert.equal(result.inputMode, 'binary')
    assert.equal(result.extractedText, null)
    assert.equal(result.diagnostics.extractionMethod, 'pdf_binary_provider_input')
    assert.equal(result.diagnostics.extractedTextCharCount, 0)
    assert.equal(result.diagnostics.normalizedTextFingerprint, null)
    assert.equal(result.diagnostics.pdfCanonicalExtractionObserveOnlyEnabled, true)
    assert.equal(result.diagnostics.pdfCanonicalExtractionObserveOnly.success, true)
    assert.equal(result.diagnostics.pdfCanonicalExtractionObserveOnly.qualityClassification, 'usable_text_extraction')
    assert.match(result.diagnostics.pdfCanonicalExtractionObserveOnly.normalizedFingerprint, /^[a-f0-9]{64}$/)

    const serializedLogs = JSON.stringify(logged)
    assert.equal(serializedLogs.includes('Synthetic Candidate Alpha'), false)
    assert.equal(serializedLogs.includes('synthetic-equivalent-resume'), false)
  } finally {
    restoreEnv()
  }
})

test('PDF observe-only extraction classifies missing-text and malformed PDFs without throwing', async () => {
  const restoreEnv = withPdfObserveOnlyEnv({
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '100',
  })
  try {
    const missing = buildMissingTextPdfFixture()
    __setPdfJsClientForTests(buildPdfJsTextContentMockFromFixtures([missing]))
    const missingResult = await prepareResumePayloadForAnalysis({
      fileBufferBase64: missing.buffer.toString('base64'),
      mimeType: 'application/pdf',
      filename: missing.filename,
      fileSize: missing.buffer.length,
      logger: quietLogger,
    })
    assert.equal(missingResult.inputKind, 'pdf_binary')
    assert.equal(missingResult.diagnostics.pdfCanonicalExtractionObserveOnly.qualityClassification, 'likely_scanned_pdf')
    assert.equal(missingResult.diagnostics.pdfCanonicalExtractionObserveOnly.ocrRequired, true)

    const malformed = buildMalformedPdfFixture()
    const malformedResult = await prepareResumePayloadForAnalysis({
      fileBufferBase64: malformed.buffer.toString('base64'),
      mimeType: 'application/pdf',
      filename: malformed.filename,
      fileSize: malformed.buffer.length,
      logger: quietLogger,
    })
    assert.equal(malformedResult.inputKind, 'pdf_binary')
    assert.equal(malformedResult.diagnostics.pdfCanonicalExtractionObserveOnly.success, false)
    assert.equal(malformedResult.diagnostics.pdfCanonicalExtractionObserveOnly.failureCategory, 'malformed_pdf')
  } finally {
    restoreEnv()
  }
})
