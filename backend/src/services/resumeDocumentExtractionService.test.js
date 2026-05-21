import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareResumePayloadForAnalysis } from './resumeDocumentExtractionService.js'

test('prepareResumePayloadForAnalysis leaves pdf payload untouched', async () => {
  const payload = {
    fileBufferBase64: Buffer.from('pdf-bytes', 'utf8').toString('base64'),
    mimeType: 'application/pdf',
    filename: 'resume.pdf',
  }
  const result = await prepareResumePayloadForAnalysis(payload)
  assert.deepEqual(result, {
    ...payload,
    inputMode: 'document_file',
  })
})

test('prepareResumePayloadForAnalysis keeps text/plain payload unchanged', async () => {
  const text = 'Jane Doe\nSoftware Engineer'
  const payload = {
    fileBufferBase64: Buffer.from(text, 'utf8').toString('base64'),
    mimeType: 'text/plain',
    filename: 'resume.txt',
  }
  const result = await prepareResumePayloadForAnalysis(payload)
  assert.equal(result.mimeType, 'text/plain')
  assert.equal(result.fileBufferBase64, payload.fileBufferBase64)
  assert.equal(result.inputMode, 'document_file')
})

test('prepareResumePayloadForAnalysis rejects legacy .doc uploads', async () => {
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: Buffer.from('fake', 'utf8').toString('base64'),
      mimeType: 'application/msword',
      filename: 'resume.doc',
    }),
    /legacy_word_format::/,
  )
})

test('prepareResumePayloadForAnalysis fails corrupt .docx before AI call', async () => {
  await assert.rejects(
    () => prepareResumePayloadForAnalysis({
      fileBufferBase64: Buffer.from('not-a-docx', 'utf8').toString('base64'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'resume.docx',
    }),
    /docx_empty_extraction::/,
  )
})
