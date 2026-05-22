import test from 'node:test'
import assert from 'node:assert/strict'

import { prepareResumePayloadForAnalysis } from './resumeDocumentExtractionService.js'

test('prepareResumePayloadForAnalysis keeps PDF payload unchanged', async () => {
  const payload = Buffer.from('fake pdf bytes').toString('base64')
  const result = await prepareResumePayloadForAnalysis({
    fileBufferBase64: payload,
    mimeType: 'application/pdf',
    filename: 'resume.pdf',
  })

  assert.equal(result.fileBufferBase64, payload)
  assert.equal(result.mimeType, 'application/pdf')
  assert.equal(result.inputMode, 'binary')
})

test('prepareResumePayloadForAnalysis accepts DOCX MIME and extracts text as text/plain', async () => {
  const fakeDocxBuffer = Buffer.from('not-a-real-docx')
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: fakeDocxBuffer.toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'resume.docx',
    }),
    /docx_empty_extraction::/,
  )
})

test('prepareResumePayloadForAnalysis accepts octet-stream DOCX via extension fallback path', async () => {
  const fakeDocxBuffer = Buffer.from('not-a-real-docx')
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: fakeDocxBuffer.toString('base64'),
      mimeType: 'application/octet-stream',
      filename: 'resume.docx',
    }),
    /docx_empty_extraction::/,
  )
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
