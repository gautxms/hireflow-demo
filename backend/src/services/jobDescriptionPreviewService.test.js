import test from 'node:test'
import assert from 'node:assert/strict'
import {
  JobDescriptionPreviewError,
  MAX_JD_PREVIEW_FILE_BYTES,
  normalizeJobDescriptionPreview,
  previewJobDescription,
} from './jobDescriptionPreviewService.js'

const pdfFile = (content = '%PDF-1.7 test') => ({
  originalname: 'role.pdf',
  mimetype: 'application/pdf',
  buffer: Buffer.from(content),
})

const documentText = `Senior Backend Engineer
Remote role in Mumbai. 4 to 6 years of experience.
Responsibilities: Build APIs and support production services.
Requirements: Node.js and PostgreSQL experience.`

function fakeDependencies(overrides = {}) {
  return {
    extractPdf: async () => ({ success: true, canonicalText: documentText.toLowerCase(), extractedText: documentText, ocrRequired: false, pageLimitReached: false }),
    loadCredentials: async () => ({ activeProvider: 'anthropic' }),
    callModel: async () => JSON.stringify({
      title: 'Senior Backend Engineer',
      responsibilities: 'Build APIs and support production services.',
      requirements: 'Node.js and PostgreSQL experience.',
      skills: ['Node.js', 'PostgreSQL', 'Node.js'],
      location: 'Mumbai',
      experienceMin: 4,
      experienceMax: 6,
      workMode: 'Remote',
      additionalInfo: null,
    }),
    ...overrides,
  }
}

test('returns reviewable fields while preserving the complete extracted text', async () => {
  let receivedText
  let includeExtractedText
  const result = await previewJobDescription(pdfFile(), fakeDependencies({
    extractPdf: async (_buffer, options) => {
      includeExtractedText = options.includeExtractedText
      return { success: true, canonicalText: documentText.toLowerCase(), extractedText: documentText, ocrRequired: false }
    },
    callModel: async (text) => {
      receivedText = text
      return JSON.stringify({ title: 'Senior Backend Engineer', responsibilities: 'Build APIs', requirements: 'Node.js', skills: ['Node.js'], experienceMin: 4, experienceMax: 6, workMode: 'remote' })
    },
  }))
  assert.equal(receivedText, documentText)
  assert.equal(includeExtractedText, true)
  assert.equal(result.fields.description, documentText)
  assert.equal(result.fields.title, 'Senior Backend Engineer')
  assert.equal(result.fields.workMode, 'remote')
  assert.equal(result.fields.experienceMax, 6)
  assert.deepEqual(result.fields.skills, ['Node.js'])
  assert.deepEqual(result.warnings, [])
  assert.equal('status' in result.fields, false)
})

test('missing fields remain empty and contradictory experience is flagged', () => {
  const result = normalizeJobDescriptionPreview({ title: '', skills: ['React', 'React'], experienceMin: 8, experienceMax: 3, workMode: 'unknown' }, documentText)
  assert.equal(result.fields.workMode, null)
  assert.equal(result.fields.experienceMin, null)
  assert.equal(result.fields.experienceMax, null)
  assert.deepEqual(result.fields.skills, ['React'])
  assert.deepEqual(result.warnings, ['JOB_TITLE_NOT_FOUND', 'EXPERIENCE_RANGE_UNCLEAR'])
})

test('does not call AI for a scanned or incomplete PDF', async () => {
  let called = false
  await assert.rejects(
    previewJobDescription(pdfFile(), fakeDependencies({
      extractPdf: async () => ({ success: true, canonicalText: 'image', ocrRequired: true }),
      callModel: async () => { called = true },
    })),
    (error) => error instanceof JobDescriptionPreviewError && error.code === 'JD_OCR_REQUIRED',
  )
  await assert.rejects(
    previewJobDescription(pdfFile(), fakeDependencies({
      extractPdf: async () => ({ success: true, canonicalText: documentText, pageLimitReached: true }),
      callModel: async () => { called = true },
    })),
    (error) => error.code === 'JD_UNREADABLE',
  )
  assert.equal(called, false)
})

test('rejects invalid content, unsupported types, and oversized files before parsing', async () => {
  for (const [file, code] of [
    [pdfFile('not a PDF'), 'JD_INVALID_FILE'],
    [{ ...pdfFile(), originalname: 'role.txt' }, 'JD_UNSUPPORTED_FILE'],
    [{ ...pdfFile(), buffer: Buffer.alloc(MAX_JD_PREVIEW_FILE_BYTES + 1) }, 'JD_FILE_TOO_LARGE'],
  ]) {
    await assert.rejects(previewJobDescription(file, fakeDependencies()), (error) => error.code === code)
  }
})

test('supports DOCX using the existing text extractor and rejects malformed model output', async () => {
  const file = {
    originalname: 'role.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('PK-placeholder'),
  }
  const result = await previewJobDescription(file, fakeDependencies({
    extractDocx: async () => documentText,
  }))
  assert.equal(result.fields.description, documentText)

  await assert.rejects(
    previewJobDescription(file, fakeDependencies({ extractDocx: async () => documentText, callModel: async () => 'not JSON' })),
    (error) => error.code === 'JD_EXTRACTION_FAILED' && error.status === 502,
  )
})
