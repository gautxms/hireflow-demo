import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

import { inspectDocxBuffer, prepareResumePayloadForAnalysis } from './resumeDocumentExtractionService.js'

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

const quietLogger = {
  debug() {},
  warn() {},
}

test('prepareResumePayloadForAnalysis keeps PDF payload unchanged', async () => {
  const payload = Buffer.from('fake pdf bytes').toString('base64')
  const result = await prepareResumePayloadForAnalysis({
    fileBufferBase64: payload,
    mimeType: 'application/pdf',
    filename: 'resume.pdf',
    fileSize: Buffer.from('fake pdf bytes').length,
  })

  assert.equal(result.fileBufferBase64, payload)
  assert.equal(result.mimeType, 'application/pdf')
  assert.equal(result.preparedMimeType, 'application/pdf')
  assert.equal(result.inputKind, 'pdf_binary')
  assert.equal(result.inputMode, 'binary')
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

  assert.equal(diagnostics.filename, 'resume.docx')
  assert.equal(diagnostics.mimeType, 'application/octet-stream')
  assert.equal(diagnostics.declaredFileSize, docxBuffer.length)
  assert.equal(diagnostics.decodedBufferByteLength, docxBuffer.length)
  assert.equal(diagnostics.hasDocxZipMagic, true)
  assert.equal(diagnostics.hasWordDocumentXml, true)
  assert.equal(JSON.stringify(diagnostics).includes('Priya'), false)
})

test('prepareResumePayloadForAnalysis fails legacy .doc as unsupported before provider stage', async () => {
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: Buffer.from('legacy').toString('base64'),
      mimeType: 'application/msword',
      filename: 'resume.doc',
    }),
    /legacy_word_format::/,
  )
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
})
