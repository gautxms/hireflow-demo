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
import { buildSyntheticPdfResumeFixture, buildMissingTextPdfFixture, buildMalformedPdfFixture, buildOverPageLimitPdfFixture, buildPdfJsTextContentMockFromFixtures, SYNTHETIC_CANONICAL_RESUME_TEXT } from './resumeFormatDiagnosticFixtures.js'
import {
  __resetPdfJsClientForTests,
  __setPdfJsClientForTests,
  evaluatePdfCanonicalExtractionObserveOnlyEligibility,
} from './pdfCanonicalExtractionService.js'
import {
  __resetLegacyDocSemanticExtractorForTests,
  __setLegacyDocSemanticExtractorForTests,
  evaluateLegacyDocSemanticExtractionObserveOnlyEligibility,
  evaluateLegacyDocSemanticTextScoringExperimentEligibility,
  getLegacyDocSemanticExtractionLimits,
  observeLegacyDocSemanticExtraction,
} from './legacyDocSemanticExtractionService.js'
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
    'PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED',
    'PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS',
    'PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_ANALYSIS_IDS',
    'PDF_CANONICAL_EXTRACTION_MAX_PAGES',
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

function withLegacyDocSemanticObserveOnlyEnv(overrides = {}) {
  const keys = [
    'ENABLE_LEGACY_DOC_EXTRACTION',
    'LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED',
    'LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE',
    'LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS',
    'LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS',
    'LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED',
    'LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS',
    'LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_ANALYSIS_IDS',
    'LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_BYTES',
    'LEGACY_DOC_SEMANTIC_EXTRACTION_TIMEOUT_MS',
    'LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_OUTPUT_CHARS',
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
    __resetLegacyDocSemanticExtractorForTests()
  }
}

function buildOleDocBuffer(text = 'Jane Legacy\nSenior DOC Engineer') {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from(text, 'utf16le'),
  ])
}

async function prepareLegacyDocWithSemanticObserver({ env = {}, diagnosticsContext = {}, semanticText = 'Jane Semantic\nSenior DOC Engineer', textboxText = null, logger = quietLogger, semanticClient = null } = {}) {
  let parserCalls = 0
  __setLegacyDocSemanticExtractorForTests(semanticClient !== null ? semanticClient : {
    async extract(input) {
      parserCalls += 1
      assert.equal(Buffer.isBuffer(input), true)
      const document = {
        getBody() { return semanticText },
      }
      if (textboxText !== null) {
        document.getTextboxes = () => textboxText
      }
      return document
    },
  })
  const restore = withLegacyDocSemanticObserveOnlyEnv({
    ENABLE_LEGACY_DOC_EXTRACTION: 'true',
    ...env,
  })
  const currentLegacyText = 'Jane Legacy\nSenior DOC Engineer'
  const oleDocBuffer = buildOleDocBuffer(currentLegacyText)
  try {
    const result = await prepareResumePayloadForAnalysis({
      fileBufferBase64: oleDocBuffer.toString('base64'),
      mimeType: 'application/msword',
      filename: 'Unsafe_Candidate_Name_resume.doc',
      fileSize: oleDocBuffer.length,
      logger,
      diagnosticsContext,
    })
    return { result, parserCalls, oleDocBuffer, currentLegacyText, semanticText }
  } finally {
    restore()
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


function buildNoisyPdfFixture() {
  return buildSyntheticPdfResumeFixture({
    id: 'synthetic-noisy-pdf',
    filename: 'synthetic-noisy-resume.pdf',
    text: `${SYNTHETIC_CANONICAL_RESUME_TEXT}
${'\u0001'.repeat(80)}`,
  })
}

async function preparePdfForScoringExperiment({ fixture = buildSyntheticPdfResumeFixture(), env = {}, diagnosticsContext = {}, logger = quietLogger, client = null } = {}) {
  let parserCalls = 0
  const mock = client || buildPdfJsTextContentMockFromFixtures([fixture])
  __setPdfJsClientForTests({
    ...mock,
    getDocument(...args) {
      parserCalls += 1
      return mock.getDocument(...args)
    },
  })
  const restore = withPdfObserveOnlyEnv(env)
  try {
    const originalBase64 = fixture.buffer.toString('base64')
    const result = await prepareResumePayloadForAnalysis({
      fileBufferBase64: originalBase64,
      mimeType: 'application/pdf',
      filename: fixture.filename,
      fileSize: fixture.buffer.length,
      logger,
      diagnosticsContext,
    })
    return { result, parserCalls, fixture, originalBase64 }
  } finally {
    restore()
  }
}




test('PDF canonical text scoring experiment defaults off and preserves binary scoring payload', async () => {
  const run = await preparePdfForScoringExperiment({ diagnosticsContext: { userId: '26', analysisId: 'analysis-1' } })
  assert.equal(run.parserCalls, 0)
  assert.equal(run.result.preparedMimeType, 'application/pdf')
  assert.equal(run.result.inputKind, 'pdf_binary')
  assert.equal(run.result.inputMode, 'binary')
  assert.equal(run.result.extractedText, null)
  assert.equal(run.result.base64File, run.originalBase64)
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentMasterEnabled, false)
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentEligible, false)
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, 'master_disabled')
})

test('PDF canonical text scoring experiment master false fails closed even with allowlist', async () => {
  const run = await preparePdfForScoringExperiment({
    env: {
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'false',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: '26',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_ANALYSIS_IDS: 'analysis-1',
    },
    diagnosticsContext: { userId: '26', analysisId: 'analysis-1' },
  })
  assert.equal(run.parserCalls, 0)
  assert.equal(run.result.inputKind, 'pdf_binary')
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentEligible, false)
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, 'master_disabled')
})

test('PDF canonical text scoring experiment enabled but not allowlisted preserves binary payload', async () => {
  const run = await preparePdfForScoringExperiment({
    env: {
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: '26',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_ANALYSIS_IDS: 'analysis-1',
    },
    diagnosticsContext: { userId: '99', analysisId: 'analysis-2' },
  })
  assert.equal(run.parserCalls, 0)
  assert.equal(run.result.inputKind, 'pdf_binary')
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentMasterEnabled, true)
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentEligible, false)
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentEligibilityReason, 'not_allowlisted')
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, 'not_allowlisted')
})

test('PDF canonical text scoring experiment allowlisted user with usable extraction selects text/plain canonical text', async () => {
  const run = await preparePdfForScoringExperiment({
    env: {
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: '26',
    },
    diagnosticsContext: { userId: '26', analysisId: 'analysis-2' },
  })
  assert.equal(run.parserCalls, 1)
  assert.equal(run.result.preparedMimeType, 'text/plain')
  assert.equal(run.result.mimeType, 'text/plain')
  assert.equal(run.result.sourceFormat, 'pdf')
  assert.equal(run.result.inputKind, 'extracted_text')
  assert.equal(run.result.inputMode, 'extracted_text')
  assert.equal(run.result.base64File, null)
  assert.equal(run.result.fileBufferBase64, Buffer.from(run.result.extractedText, 'utf8').toString('base64'))
  assert.equal(run.result.extractedText, SYNTHETIC_CANONICAL_RESUME_TEXT.toLowerCase())
  assert.equal(run.result.diagnostics.originalMimeType, 'application/pdf')
  assert.equal(run.result.diagnostics.preparedMimeType, 'text/plain')
  assert.equal(run.result.diagnostics.extractionMethod, 'pdfjs_dist_canonical_text_scoring_experiment')
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentEligibilityReason, 'user_allowlist')
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, 'canonical_text_selected')
  assert.equal(JSON.stringify(run.result.diagnostics).includes(SYNTHETIC_CANONICAL_RESUME_TEXT), false)
})

test('PDF canonical text scoring experiment allowlisted analysis ID with usable extraction selects text/plain canonical text', async () => {
  const run = await preparePdfForScoringExperiment({
    env: {
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_ANALYSIS_IDS: 'analysis-2',
    },
    diagnosticsContext: { userId: '99', analysisId: 'analysis-2' },
  })
  assert.equal(run.parserCalls, 1)
  assert.equal(run.result.inputKind, 'extracted_text')
  assert.equal(run.result.preparedMimeType, 'text/plain')
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentEligibilityReason, 'analysis_allowlist')
  assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringExperimentMatchedAllowlistType, 'analysis_id')
})

test('PDF canonical text scoring experiment parser failure and malformed PDFs fall back to original binary', async () => {
  const failingClient = {
    version: 'failure-mock',
    getDocument() {
      throw new Error('synthetic failure with Jane Doe jane@example.com 555-0100')
    },
  }
  const parserFailure = await preparePdfForScoringExperiment({
    env: {
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: '26',
    },
    diagnosticsContext: { userId: '26' },
    client: failingClient,
  })
  assert.equal(parserFailure.parserCalls, 1)
  assert.equal(parserFailure.result.inputKind, 'pdf_binary')
  assert.equal(parserFailure.result.base64File, parserFailure.originalBase64)
  assert.equal(parserFailure.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, 'extraction_failed')

  const malformed = await preparePdfForScoringExperiment({
    fixture: buildMalformedPdfFixture(),
    env: {
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: '26',
    },
    diagnosticsContext: { userId: '26' },
  })
  assert.equal(malformed.parserCalls, 0)
  assert.equal(malformed.result.inputKind, 'pdf_binary')
  assert.equal(malformed.result.base64File, malformed.originalBase64)
  assert.equal(malformed.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, 'extraction_failed')
})

test('PDF canonical text scoring experiment unsafe quality classifications fall back to binary', async () => {
  const cases = [
    { name: 'low-density', fixture: buildSyntheticPdfResumeFixture({ text: 'Short text only but not empty.' }), reason: 'ocr_required' },
    { name: 'scanned', fixture: buildMissingTextPdfFixture(), reason: 'empty_canonical_text' },
    { name: 'noisy', fixture: buildNoisyPdfFixture(), reason: 'unusable_text_extraction' },
    { name: 'truncated', fixture: buildOverPageLimitPdfFixture({ pageCount: 3 }), env: { PDF_CANONICAL_EXTRACTION_MAX_PAGES: '1' }, reason: 'observation_truncated' },
  ]

  for (const entry of cases) {
    const run = await preparePdfForScoringExperiment({
      fixture: entry.fixture,
      env: {
        PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
        PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: '26',
        ...(entry.env || {}),
      },
      diagnosticsContext: { userId: '26', analysisId: `analysis-${entry.name}` },
    })
    assert.equal(run.result.inputKind, 'pdf_binary', entry.name)
    assert.equal(run.result.preparedMimeType, 'application/pdf', entry.name)
    assert.equal(run.result.fileBufferBase64, run.originalBase64, entry.name)
    assert.equal(run.result.base64File, run.originalBase64, entry.name)
    assert.equal(run.result.diagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, entry.reason, entry.name)
  }
})

test('PDF canonical text scoring experiment canonical text path logs no resume text, filename, email, phone, or base64', async () => {
  const logged = []
  const logger = {
    debug(message, payload) { logged.push({ level: 'debug', message, payload }) },
    info(message, payload) { logged.push({ level: 'info', message, payload }) },
    warn(message, payload) { logged.push({ level: 'warn', message, payload }) },
    log(message, payload) { logged.push({ level: 'log', message, payload }) },
  }
  const piiText = `${SYNTHETIC_CANONICAL_RESUME_TEXT}\nEmail: jane.private@example.com\nPhone: 555-0100`
  const fixture = buildSyntheticPdfResumeFixture({ filename: 'Jane_Private_Resume.pdf', text: piiText })
  const run = await preparePdfForScoringExperiment({
    fixture,
    logger,
    env: {
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: '26',
    },
    diagnosticsContext: { userId: '26' },
  })
  assert.equal(run.result.inputKind, 'extracted_text')
  const serializedLogs = JSON.stringify(logged)
  const serializedDiagnostics = JSON.stringify(run.result.diagnostics)
  for (const serialized of [serializedLogs, serializedDiagnostics]) {
    assert.equal(serialized.includes('Synthetic Candidate Alpha'), false)
    assert.equal(serialized.includes('jane.private@example.com'), false)
    assert.equal(serialized.includes('555-0100'), false)
    assert.equal(serialized.includes('Jane_Private_Resume'), false)
    assert.equal(serialized.includes(run.originalBase64), false)
  }
})

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

test('PDF observe-only deterministic sampling is bounded, stable, and fails closed for unsafe values', () => {
  const base = {
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: '',
    PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS: '',
  }
  const evaluateRate = (rate) => evaluatePdfCanonicalExtractionObserveOnlyEligibility({
    env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: rate },
    fileContentFingerprint: 'file-fp-1',
  })

  assert.equal(evaluateRate('0').sampleRate, 0)
  assert.equal(evaluateRate('0').sampled, false)
  assert.equal(evaluateRate('1').sampleRate, 1)
  assert.equal(evaluateRate('5').sampleRate, 5)
  assert.equal(evaluateRate('100').sampleRate, 100)
  assert.equal(evaluateRate('100').sampled, true)
  assert.equal(evaluateRate('-1').sampleRate, 0)
  assert.equal(evaluateRate('invalid').sampleRate, 0)
  assert.equal(evaluateRate('').sampleRate, 0)
  assert.equal(evaluateRate('100.5').sampleRate, 0)
  assert.equal(evaluateRate('250').sampleRate, 0)
  assert.equal(evaluateRate('1000').sampleRate, 0)

  const first = evaluateRate('5')
  const second = evaluateRate('5')
  const different = evaluatePdfCanonicalExtractionObserveOnlyEligibility({ env: { ...base, PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '5' }, fileContentFingerprint: 'file-fp-2' })
  assert.equal(first.samplingBucket, second.samplingBucket)
  assert.equal(first.sampled, second.sampled)
  assert.notEqual(first.samplingBucket, different.samplingBucket)
})

async function preparePdfAndCollectEligibilityLogs(env, diagnosticsContext = {}) {
  const fixture = buildSyntheticPdfResumeFixture()
  __setPdfJsClientForTests(buildPdfJsTextContentMockFromFixtures([fixture]))
  const restore = withPdfObserveOnlyEnv(env)
  const logs = []
  const logger = {
    debug() {},
    warn(message, payload) { logs.push({ level: 'warn', message, payload }) },
    info(message, payload) { logs.push({ level: 'info', message, payload }) },
    log(message, payload) { logs.push({ level: 'log', message, payload }) },
  }
  try {
    const result = await prepareResumePayloadForAnalysis({
      fileBufferBase64: fixture.buffer.toString('base64'),
      mimeType: 'application/pdf',
      filename: 'Unsafe_Candidate_Name_resume.pdf',
      fileSize: fixture.buffer.length,
      logger,
      diagnosticsContext,
    })
    return {
      result,
      fixture,
      eligibilityLogs: logs.filter((entry) => entry.message === '[ResumeDiagnostics] pdf_canonical_extraction_observe_only_eligibility'),
    }
  } finally {
    restore()
  }
}

test('PDF observe-only eligibility decisions are logged safely for selected and skipped PDFs', async () => {
  const cases = [
    {
      env: {},
      context: { userId: 'raw-user-26', analysisId: 'raw-analysis-master-disabled', resumeId: 'raw-resume-master-disabled' },
      reason: 'master_disabled',
    },
    {
      env: {
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
      },
      context: { userId: 'raw-user-99', analysisId: 'raw-analysis-not-selected', resumeId: 'raw-resume-not-selected' },
      reason: 'not_selected',
    },
    {
      env: {
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'raw-user-26',
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
      },
      context: { userId: 'raw-user-26', analysisId: 'raw-analysis-allowlisted', resumeId: 'raw-resume-allowlisted' },
      reason: 'user_allowlist',
    },
    {
      env: {
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '100',
      },
      context: { userId: 'raw-user-sampled', analysisId: 'raw-analysis-sampled', resumeId: 'raw-resume-sampled' },
      reason: 'deterministic_sample',
    },
  ]

  for (const entry of cases) {
    const { result, fixture, eligibilityLogs } = await preparePdfAndCollectEligibilityLogs(entry.env, entry.context)
    assert.equal(eligibilityLogs.length, 1)
    assert.equal(eligibilityLogs[0].payload.eligibilityReason, entry.reason)
    assert.deepEqual(Object.keys(eligibilityLogs[0].payload).sort(), [
      'allowlistMatched',
      'eligible',
      'eligibilityReason',
      'masterEnabled',
      'matchedAllowlistType',
      'sampleRate',
      'sampled',
      'samplingBucket',
    ].sort())
    const serializedEligibilityLog = JSON.stringify(eligibilityLogs)
    assert.equal(serializedEligibilityLog.includes(entry.context.userId), false)
    assert.equal(serializedEligibilityLog.includes(entry.context.analysisId), false)
    assert.equal(serializedEligibilityLog.includes(entry.context.resumeId), false)
    assert.equal(serializedEligibilityLog.includes('Unsafe_Candidate_Name'), false)
    assert.equal(serializedEligibilityLog.includes(fixture.buffer.toString('base64')), false)
    assert.equal(result.inputKind, 'pdf_binary')
    assert.equal(result.extractedText, null)
  }
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


test('legacy DOC semantic observe-only eligibility is default-off and deterministic', () => {
  const base = {
    LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: '',
    LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS: '',
  }

  assert.equal(evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: {}, isLegacyBinaryDoc: true }).sampleRate, 0)
  assert.equal(evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: {}, isLegacyBinaryDoc: true }).eligible, false)
  assert.equal(evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: { LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'false' }, isLegacyBinaryDoc: true }).eligibilityReason, 'master_disabled')
  assert.equal(evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: base, isLegacyBinaryDoc: false }).eligibilityReason, 'unsupported_format')
  assert.equal(evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: { ...base, LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0' }, isLegacyBinaryDoc: true }).eligibilityReason, 'not_allowlisted')

  const userAllowed = evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({
    env: { ...base, LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-1,user-2' },
    userId: 'user-2',
    isLegacyBinaryDoc: true,
  })
  assert.equal(userAllowed.eligible, true)
  assert.equal(userAllowed.eligibilityReason, 'user_allowlist')
  assert.equal(userAllowed.matchedAllowlistType, 'user_id')

  const analysisAllowed = evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({
    env: { ...base, LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS: 'analysis-1,analysis-2' },
    analysisId: 'analysis-2',
    isLegacyBinaryDoc: true,
  })
  assert.equal(analysisAllowed.eligible, true)
  assert.equal(analysisAllowed.eligibilityReason, 'analysis_allowlist')
  assert.equal(analysisAllowed.matchedAllowlistType, 'analysis_id')

  const first = evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: { ...base, LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '5' }, fileContentFingerprint: 'file-fp-1', isLegacyBinaryDoc: true })
  const second = evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: { ...base, LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '5' }, fileContentFingerprint: 'file-fp-1', isLegacyBinaryDoc: true })
  const different = evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: { ...base, LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '5' }, fileContentFingerprint: 'file-fp-2', isLegacyBinaryDoc: true })
  assert.equal(first.samplingBucket, second.samplingBucket)
  assert.equal(first.sampled, second.sampled)
  assert.notEqual(first.samplingBucket, different.samplingBucket)
  assert.equal(evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: { ...base, LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '100' }, fileContentFingerprint: 'file-fp-1', isLegacyBinaryDoc: true }).sampled, true)
  assert.equal(evaluateLegacyDocSemanticExtractionObserveOnlyEligibility({ env: { ...base, LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '100.5' }, fileContentFingerprint: 'file-fp-1', isLegacyBinaryDoc: true }).sampleRate, 0)
})

test('legacy DOC semantic observe-only stays disabled unless allowlisted or sampled', async () => {
  const unset = await prepareLegacyDocWithSemanticObserver()
  assert.equal(unset.parserCalls, 0)
  assert.equal(unset.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(unset.result.diagnostics.legacyDocSemanticExtractionObserveOnly.enabled, false)
  assert.equal(unset.result.diagnostics.legacyDocSemanticExtractionObserveOnly.eligible, false)
  assert.equal(unset.result.diagnostics.legacyDocSemanticExtractionObserveOnly.eligibilityReason, 'master_disabled')

  const notAllowlisted = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    },
  })
  assert.equal(notAllowlisted.parserCalls, 0)
  assert.equal(notAllowlisted.result.diagnostics.legacyDocSemanticExtractionObserveOnly.eligibilityReason, 'not_allowlisted')
})

test('legacy DOC semantic observe-only can run for user and analysis allowlists without changing scoring payload', async () => {
  const userAllowed = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    },
    diagnosticsContext: { userId: 'user-42', analysisId: 'analysis-7', resumeId: 'resume-7' },
  })
  assert.equal(userAllowed.parserCalls, 1)
  assert.equal(userAllowed.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(userAllowed.result.inputKind, 'extracted_text')
  assert.equal(userAllowed.result.inputMode, 'extracted_text')
  assert.equal(userAllowed.result.preparedMimeType, 'text/plain')
  assert.equal(userAllowed.result.extractedText, userAllowed.currentLegacyText)
  assert.equal(userAllowed.result.fileBufferBase64, Buffer.from(userAllowed.currentLegacyText, 'utf8').toString('base64'))
  assert.equal(userAllowed.result.diagnostics.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(userAllowed.result.diagnostics.legacyDocSemanticExtractionObserveOnly.success, false)
  assert.equal(userAllowed.result.diagnostics.legacyDocSemanticExtractionObserveOnly.qualityClassification, 'text_too_short')
  assert.equal(userAllowed.result.diagnostics.legacyDocSemanticExtractionObserveOnly.extractionMethod, 'legacy_doc_word_extractor_observe_only')
  assert.equal(userAllowed.result.diagnostics.legacyDocSemanticExtractionObserveOnly.parserPackageName, 'word-extractor')
  assert.equal(userAllowed.result.diagnostics.legacyDocSemanticExtractionObserveOnly.parserPackageVersion, '1.0.4')
  assert.match(userAllowed.result.diagnostics.legacyDocSemanticExtractionObserveOnly.semanticNormalizedFingerprint, /^[a-f0-9]{64}$/)

  const analysisAllowed = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS: 'analysis-42',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    },
    diagnosticsContext: { userId: 'user-99', analysisId: 'analysis-42', resumeId: 'resume-42' },
  })
  assert.equal(analysisAllowed.parserCalls, 1)
  assert.equal(analysisAllowed.result.diagnostics.legacyDocSemanticExtractionObserveOnly.eligibilityReason, 'analysis_allowlist')
  assert.equal(analysisAllowed.result.diagnostics.legacyDocSemanticExtractionObserveOnly.matchedAllowlistType, 'analysis_id')
})



test('legacy DOC semantic text scoring experiment is default-off and allowlist gated', async () => {
  const usableSemanticText = [
    'Semantic Candidate Summary with enough resume detail for safe extraction scoring.',
    'Experience includes backend services, hiring workflows, analytics, and production operations.',
    'Skills include Node.js, PostgreSQL, distributed systems, reliability, and recruiting SaaS.',
  ].join('\n')

  assert.equal(evaluateLegacyDocSemanticTextScoringExperimentEligibility({ isLegacyBinaryDoc: true }).eligible, false)

  const unset = await prepareLegacyDocWithSemanticObserver({ semanticText: usableSemanticText })
  assert.equal(unset.parserCalls, 0)
  assert.equal(unset.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(unset.result.extractedText, unset.currentLegacyText)
  assert.equal(unset.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringExperimentMasterEnabled, false)
  assert.equal(unset.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'master_disabled')

  const notAllowlisted = await prepareLegacyDocWithSemanticObserver({
    env: { LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED: 'true' },
    diagnosticsContext: { userId: 'user-not-allowed', analysisId: 'analysis-not-allowed' },
    semanticText: usableSemanticText,
  })
  assert.equal(notAllowlisted.parserCalls, 0)
  assert.equal(notAllowlisted.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(notAllowlisted.result.extractedText, notAllowlisted.currentLegacyText)
  assert.equal(notAllowlisted.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringExperimentEligible, false)
  assert.equal(notAllowlisted.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'not_allowlisted')
})

test('legacy DOC semantic text scoring experiment selects semantic text for user or analysis allowlist only after quality gates pass', async () => {
  const usableSemanticText = [
    'Semantic Candidate Summary with enough resume detail for safe extraction scoring.',
    'Experience includes backend services, hiring workflows, analytics, and production operations.',
    'Skills include Node.js, PostgreSQL, distributed systems, reliability, and recruiting SaaS.',
  ].join('\n')

  const userAllowed = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42', analysisId: 'analysis-7' },
    semanticText: usableSemanticText,
  })
  assert.equal(userAllowed.parserCalls, 1)
  assert.equal(userAllowed.result.extractionMethod, 'legacy_doc_word_extractor_semantic_text_scoring_experiment')
  assert.equal(userAllowed.result.extractedText, usableSemanticText.toLowerCase())
  assert.equal(userAllowed.result.preparedMimeType, 'text/plain')
  assert.equal(userAllowed.result.inputKind, 'extracted_text')
  assert.equal(userAllowed.result.inputMode, 'extracted_text')
  assert.equal(userAllowed.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringExperimentMatchedAllowlistType, 'user_id')
  assert.equal(userAllowed.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'semantic_text_selected')

  const analysisAllowed = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_ANALYSIS_IDS: 'analysis-42',
    },
    diagnosticsContext: { userId: 'user-99', analysisId: 'analysis-42' },
    semanticText: usableSemanticText,
  })
  assert.equal(analysisAllowed.parserCalls, 1)
  assert.equal(analysisAllowed.result.extractionMethod, 'legacy_doc_word_extractor_semantic_text_scoring_experiment')
  assert.equal(analysisAllowed.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringExperimentEligibilityReason, 'analysis_allowlist')
  assert.equal(analysisAllowed.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringExperimentMatchedAllowlistType, 'analysis_id')
})

test('legacy DOC semantic text scoring experiment reuses observe-only extraction and invokes parser once', async () => {
  const usableSemanticText = [
    'Semantic Candidate Summary with enough resume detail for safe extraction scoring.',
    'Experience includes backend services, hiring workflows, analytics, and production operations.',
    'Skills include Node.js, PostgreSQL, distributed systems, reliability, and recruiting SaaS.',
  ].join('\n')
  const observedAndScored = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
      LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42', analysisId: 'analysis-7' },
    semanticText: usableSemanticText,
  })
  assert.equal(observedAndScored.parserCalls, 1)
  assert.equal(observedAndScored.result.extractionMethod, 'legacy_doc_word_extractor_semantic_text_scoring_experiment')
  assert.equal(observedAndScored.result.diagnostics.legacyDocSemanticExtractionObserveOnly.success, true)
  assert.equal(observedAndScored.result.diagnostics.legacyDocSemanticTextScoringExperiment.semanticExtractionReused, true)
})

test('legacy DOC semantic text scoring experiment falls back safely for failures and quality gates', async () => {
  const baseEnv = {
    LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
    LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: 'user-42',
  }
  const diagnosticsContext = { userId: 'user-42' }

  const importFailure = await prepareLegacyDocWithSemanticObserver({ env: baseEnv, diagnosticsContext, semanticClient: false })
  assert.equal(importFailure.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(importFailure.result.extractedText, importFailure.currentLegacyText)
  assert.equal(importFailure.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'semantic_extraction_failed')

  const parserError = await prepareLegacyDocWithSemanticObserver({
    env: baseEnv,
    diagnosticsContext,
    semanticClient: { async extract() { throw new Error('parser boom with candidate@example.com') } },
  })
  assert.equal(parserError.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(parserError.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'semantic_extraction_failed')

  const timeout = await prepareLegacyDocWithSemanticObserver({
    env: { ...baseEnv, LEGACY_DOC_SEMANTIC_EXTRACTION_TIMEOUT_MS: '1' },
    diagnosticsContext,
    semanticClient: { async extract() { return new Promise((resolve) => setTimeout(() => resolve({ getBody: () => 'late semantic text' }), 50)) } },
  })
  assert.equal(timeout.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(timeout.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'parser_timeout')

  const empty = await prepareLegacyDocWithSemanticObserver({ env: baseEnv, diagnosticsContext, semanticText: '' })
  assert.equal(empty.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(empty.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'empty_semantic_text')

  const tooLarge = await prepareLegacyDocWithSemanticObserver({ env: { ...baseEnv, LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_BYTES: '8' }, diagnosticsContext })
  assert.equal(tooLarge.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(tooLarge.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'file_too_large')

  const truncated = await prepareLegacyDocWithSemanticObserver({
    env: { ...baseEnv, LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_OUTPUT_CHARS: '20' },
    diagnosticsContext,
    semanticText: 'A long semantic resume body that must be capped before diagnostics and never scored partially.',
  })
  assert.equal(truncated.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(truncated.result.extractedText, truncated.currentLegacyText)
  assert.equal(truncated.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'output_truncated')

  const duplicate = await prepareLegacyDocWithSemanticObserver({
    env: baseEnv,
    diagnosticsContext,
    semanticText: Array(8).fill('Repeated resume line with enough semantic content to be unsafe').join('\n'),
  })
  assert.equal(duplicate.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(duplicate.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'quality_gate_failed_duplicate_line_ratio')

  const suspiciousNoise = await prepareLegacyDocWithSemanticObserver({
    env: baseEnv,
    diagnosticsContext,
    semanticText: 'Semantic resume detail with production operations and recruiting analytics.\nSkills include Node.js, PostgreSQL, reliability, and workflow automation.�',
  })
  assert.equal(suspiciousNoise.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(suspiciousNoise.result.diagnostics.legacyDocSemanticTextScoringExperiment.scoringFallbackReason, 'quality_gate_failed_suspicious_noise_ratio')
})

test('legacy DOC semantic text scoring experiment diagnostics omit raw text and PII-like values', async () => {
  const semanticText = 'Private Candidate\nprivate.candidate@example.com\n555-333-2222\nExperience includes Node.js platform leadership and recruiting SaaS operations.'
  const { result } = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42', analysisId: 'analysis-private', resumeId: 'resume-private' },
    semanticText,
  })
  const serializedDiagnostics = JSON.stringify(result.diagnostics.legacyDocSemanticTextScoringExperiment)
  for (const unsafe of ['Private Candidate', 'private.candidate@example.com', '555-333-2222', 'Unsafe_Candidate_Name', 'analysis-private', 'resume-private', Buffer.from(semanticText).toString('base64')]) {
    assert.equal(serializedDiagnostics.includes(unsafe), false)
  }
  for (const unsafeKey of ['semanticText', 'extractedText', 'text', 'base64File', 'fileBufferBase64']) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.diagnostics.legacyDocSemanticTextScoringExperiment, unsafeKey), false)
  }
})

test('legacy DOC semantic observe-only includes textbox-only visible content without changing scoring payload', async () => {
  const textboxText = [
    'Textbox Resume Candidate',
    'Summary: product engineering leader with platform modernization experience.',
    'Skills: Node.js, PostgreSQL, distributed systems, hiring operations.',
    'Experience: led recruiting workflow automation and analytics delivery.',
  ].join('\n')
  const observed = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
    },
    diagnosticsContext: { userId: 'user-42' },
    semanticText: '',
    textboxText,
  })
  const diagnostics = observed.result.diagnostics.legacyDocSemanticExtractionObserveOnly

  assert.equal(observed.parserCalls, 1)
  assert.equal(observed.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(observed.result.preparedMimeType, 'text/plain')
  assert.equal(observed.result.inputKind, 'extracted_text')
  assert.equal(observed.result.inputMode, 'extracted_text')
  assert.equal(observed.result.extractedText, observed.currentLegacyText)
  assert.equal(observed.result.fileBufferBase64, Buffer.from(observed.currentLegacyText, 'utf8').toString('base64'))
  assert.equal(diagnostics.success, true)
  assert.equal(diagnostics.qualityClassification, 'usable_text_extraction')
  assert.ok(diagnostics.semanticNormalizedCharCount >= 80)
  assert.equal(diagnostics.semanticNormalizedLineCount, 4)
  assert.match(diagnostics.semanticNormalizedFingerprint, /^[a-f0-9]{64}$/)
})

test('legacy DOC semantic observe-only combines body and textbox content safely', async () => {
  const bodyText = [
    'Body Resume Candidate',
    'Summary: backend engineering manager with SaaS reliability ownership.',
    'Experience: improved parsing pipelines and operational diagnostics.',
  ].join('\n')
  const textboxText = [
    'Textbox Skills: Node.js, observability, incident response, recruiting systems.',
    'Textbox Education: Computer Science and applied distributed systems.',
  ].join('\n')
  const logs = []
  const logger = {
    debug() {},
    info(message, payload) { logs.push({ message, payload }) },
    warn(message, payload) { logs.push({ message, payload }) },
    log(message, payload) { logs.push({ message, payload }) },
  }

  const observed = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42' },
    semanticText: bodyText,
    textboxText,
    logger,
  })
  const diagnostics = observed.result.diagnostics.legacyDocSemanticExtractionObserveOnly
  const bodyOnlyChars = bodyText.toLowerCase().length
  const textboxOnlyChars = textboxText.toLowerCase().length
  const serializedDiagnostics = JSON.stringify(diagnostics)
  const serializedSemanticLogs = JSON.stringify(logs.filter((entry) => String(entry.message || '').includes('legacy_doc_semantic_extraction_observe_only')))

  assert.equal(diagnostics.success, true)
  assert.equal(diagnostics.qualityClassification, 'usable_text_extraction')
  assert.ok(diagnostics.semanticNormalizedCharCount > bodyOnlyChars)
  assert.ok(diagnostics.semanticNormalizedCharCount > textboxOnlyChars)
  assert.equal(diagnostics.semanticNormalizedLineCount, 5)
  assert.match(diagnostics.semanticNormalizedFingerprint, /^[a-f0-9]{64}$/)
  for (const unsafe of ['Body Resume Candidate', 'Textbox Skills', 'Textbox Education']) {
    assert.equal(serializedDiagnostics.includes(unsafe), false)
    assert.equal(serializedSemanticLogs.includes(unsafe), false)
  }
  assert.equal(observed.result.extractedText, observed.currentLegacyText)
  assert.equal(observed.result.fileBufferBase64, Buffer.from(observed.currentLegacyText, 'utf8').toString('base64'))
})

test('legacy DOC semantic observe-only keeps existing behavior when textbox getter is absent', async () => {
  const observed = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42' },
    semanticText: 'Jane Semantic\nSenior DOC Engineer',
  })
  const diagnostics = observed.result.diagnostics.legacyDocSemanticExtractionObserveOnly

  assert.equal(observed.parserCalls, 1)
  assert.equal(diagnostics.qualityClassification, 'text_too_short')
  assert.equal(diagnostics.semanticNormalizedLineCount, 2)
  assert.match(diagnostics.semanticNormalizedFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(observed.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(observed.result.fileBufferBase64, Buffer.from(observed.currentLegacyText, 'utf8').toString('base64'))
})

test('legacy DOC semantic observe-only does not expose textbox PII in diagnostics or logs', async () => {
  const logs = []
  const logger = {
    debug() {},
    info(message, payload) { logs.push({ message, payload }) },
    warn(message, payload) { logs.push({ message, payload }) },
    log(message, payload) { logs.push({ message, payload }) },
  }
  const textboxText = [
    'Textbox Candidate Jane Private',
    'Email jane.private@example.com',
    'Phone 555-222-3333',
    'Summary: engineering leader with recruiting workflow expertise and systems experience.',
  ].join('\n')

  const observed = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42', analysisId: 'analysis-textbox-private', resumeId: 'resume-textbox-private' },
    semanticText: '',
    textboxText,
    logger,
  })
  const serializedDiagnostics = JSON.stringify(observed.result.diagnostics.legacyDocSemanticExtractionObserveOnly)
  const serializedSemanticLogs = JSON.stringify(logs.filter((entry) => String(entry.message || '').includes('legacy_doc_semantic_extraction_observe_only')))

  for (const unsafe of ['Jane Private', 'jane.private@example.com', '555-222-3333', 'analysis-textbox-private', 'resume-textbox-private', Buffer.from(textboxText).toString('base64')]) {
    assert.equal(serializedDiagnostics.includes(unsafe), false)
    assert.equal(serializedSemanticLogs.includes(unsafe), false)
  }
  assert.equal(observed.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(observed.result.inputMode, 'extracted_text')
})

test('legacy DOC semantic observe-only failures and limits are safe diagnostics only', async () => {
  const tooLarge = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
      LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_BYTES: '8',
    },
    diagnosticsContext: { userId: 'user-42' },
  })
  assert.equal(tooLarge.parserCalls, 0)
  assert.equal(tooLarge.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(tooLarge.result.diagnostics.legacyDocSemanticExtractionObserveOnly.failureCategory, 'file_too_large')

  const parserError = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42' },
    semanticClient: {
      async extract() {
        throw new Error('malformed ole with candidate@example.com and 555-111-2222')
      },
    },
  })
  assert.equal(parserError.parserCalls, 0)
  assert.equal(parserError.result.extractionMethod, 'legacy_doc_text_extraction')
  assert.equal(parserError.result.diagnostics.legacyDocSemanticExtractionObserveOnly.failureCategory, 'parser_error')
  assert.match(parserError.result.diagnostics.legacyDocSemanticExtractionObserveOnly.errorFingerprint, /^[a-f0-9]{16}$/)

  const importFailure = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42' },
    semanticClient: false,
  })
  assert.equal(importFailure.result.diagnostics.legacyDocSemanticExtractionObserveOnly.failureCategory, 'dependency_import_failed')

  const empty = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42' },
    semanticText: '',
  })
  assert.equal(empty.result.diagnostics.legacyDocSemanticExtractionObserveOnly.failureCategory, 'empty_extraction')

  const truncated = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
      LEGACY_DOC_SEMANTIC_EXTRACTION_MAX_OUTPUT_CHARS: '12',
    },
    diagnosticsContext: { userId: 'user-42' },
    semanticText: 'A long semantic resume body that must be capped before diagnostics.',
  })
  assert.equal(truncated.result.diagnostics.legacyDocSemanticExtractionObserveOnly.outputTruncated, true)
  assert.equal(truncated.result.diagnostics.legacyDocSemanticExtractionObserveOnly.semanticTextLength, 12)
  assert.equal(truncated.result.extractedText, truncated.currentLegacyText)
})

test('legacy DOC semantic observe-only diagnostics and logs omit raw text and PII-like values', async () => {
  const logs = []
  const logger = {
    debug() {},
    info(message, payload) { logs.push({ message, payload }) },
    warn(message, payload) { logs.push({ message, payload }) },
    log(message, payload) { logs.push({ message, payload }) },
  }
  const semanticText = 'Sensitive Candidate\nemail candidate@example.com\nphone 555-111-2222\nSecret Skill'
  const { result } = await prepareLegacyDocWithSemanticObserver({
    env: {
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
      LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
    },
    diagnosticsContext: { userId: 'user-42', analysisId: 'analysis-secret', resumeId: 'resume-secret' },
    semanticText,
    logger,
  })
  const serializedDiagnostics = JSON.stringify(result.diagnostics.legacyDocSemanticExtractionObserveOnly)
  const serializedLogs = JSON.stringify(logs.filter((entry) => String(entry.message || '').includes('legacy_doc_semantic_extraction_observe_only')))
  for (const unsafe of ['Sensitive Candidate', 'candidate@example.com', '555-111-2222', 'Unsafe_Candidate_Name', 'analysis-secret', 'resume-secret', Buffer.from(semanticText).toString('base64')]) {
    assert.equal(serializedDiagnostics.includes(unsafe), false)
    assert.equal(serializedLogs.includes(unsafe), false)
  }
  assert.equal(Object.prototype.hasOwnProperty.call(result.diagnostics.legacyDocSemanticExtractionObserveOnly, 'semanticText'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(result.diagnostics.legacyDocSemanticExtractionObserveOnly, 'text'), false)
})


test('legacy DOC semantic observe-only timeout produces safe diagnostics only', async () => {
  assert.deepEqual(getLegacyDocSemanticExtractionLimits({}), {
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 2000,
    maxOutputChars: 20000,
  })
  __setLegacyDocSemanticExtractorForTests({
    async extract() {
      return new Promise((resolve) => setTimeout(() => resolve({ getBody: () => 'late semantic text' }), 50))
    },
  })
  try {
    const result = await observeLegacyDocSemanticExtraction(buildOleDocBuffer('Jane Timeout\nLegacy Text'), {
      env: { LEGACY_DOC_SEMANTIC_EXTRACTION_TIMEOUT_MS: '1' },
      eligibility: {
        masterEnabled: true,
        eligible: true,
        eligibilityReason: 'user_allowlist',
        allowlistMatched: true,
        matchedAllowlistType: 'user_id',
        sampled: false,
        sampleRate: 0,
        samplingBucket: null,
      },
      currentLegacyText: 'Jane Timeout\nLegacy Text',
    })
    assert.equal(result.success, false)
    assert.equal(result.failureCategory, 'parser_timeout')
    assert.equal(result.scoringFallbackReason, 'observe_only')
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'semanticText'), false)
  } finally {
    __resetLegacyDocSemanticExtractorForTests()
  }
})

test('legacy DOC semantic observe-only flag does not bypass existing legacy DOC acceptance flag', async () => {
  const restore = withLegacyDocSemanticObserveOnlyEnv({
    ENABLE_LEGACY_DOC_EXTRACTION: 'false',
    LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
    LEGACY_DOC_SEMANTIC_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: 'user-42',
  })
  __setLegacyDocSemanticExtractorForTests({
    async extract() {
      throw new Error('semantic_parser_should_not_run_when_legacy_doc_disabled')
    },
  })
  const oleDocBuffer = buildOleDocBuffer('Jane Disabled\nLegacy DOC Candidate')
  try {
    await assert.rejects(
      () => prepareResumePayloadForAnalysis({
        fileBufferBase64: oleDocBuffer.toString('base64'),
        mimeType: 'application/msword',
        filename: 'resume.doc',
        fileSize: oleDocBuffer.length,
        logger: quietLogger,
        diagnosticsContext: { userId: 'user-42' },
      }),
      (error) => {
        assert.equal(error.extractionCategory, 'resume_unsupported_legacy_doc')
        assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_rejected')
        assert.equal(error.diagnostics.legacyDocSemanticExtractionObserveOnly, undefined)
        return true
      },
    )
  } finally {
    restore()
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
