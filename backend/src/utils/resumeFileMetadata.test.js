import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDisplayFilename,
  getFileExtension,
  getOriginalFilename,
  normalizeResumeFileMetadata,
  sanitizeFilenameWithExtension,
} from './resumeFileMetadata.js'
import { isAcceptedResumeUpload, resolveEffectiveMimeType } from './fileMime.js'

test('resume filename metadata preserves normal filenames and extensions', () => {
  const metadata = normalizeResumeFileMetadata({
    originalFilename: 'resume.pdf',
    reportedMimeType: 'application/pdf',
  })

  assert.equal(metadata.originalFilename, 'resume.pdf')
  assert.equal(metadata.displayFilename, 'resume.pdf')
  assert.equal(metadata.fileExtension, 'pdf')
  assert.equal(metadata.originalMimeType, 'application/pdf')
  assert.equal(metadata.normalizedMimeType, 'application/pdf')
})

test('resume filename metadata handles multiple dots without stripping the final extension', () => {
  const metadata = normalizeResumeFileMetadata({
    originalFilename: 'Taylor.QA.Resume.v2.docx',
    reportedMimeType: 'application/octet-stream',
  })

  assert.equal(metadata.originalFilename, 'Taylor_QA_Resume_v2.docx')
  assert.equal(metadata.fileExtension, 'docx')
  assert.equal(metadata.normalizedMimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
})

test('resume filename metadata lowercases uppercase extensions for stable detection', () => {
  assert.equal(getFileExtension('Resume.PDF'), 'pdf')
  assert.equal(sanitizeFilenameWithExtension('Resume.PDF'), 'Resume.pdf')
})

test('resume filename metadata safely supports extensionless historical records', () => {
  assert.equal(getOriginalFilename({ filename: 'legacy_resume' }), 'legacy_resume')
  assert.equal(getDisplayFilename({ filename: 'legacy_resume', file_type: 'application/pdf' }), 'legacy_resume.pdf')
  assert.equal(getDisplayFilename({ filename: 'legacy_resume' }), 'legacy_resume')
})

test('resume filename metadata keeps unsafe characters out while retaining file identity', () => {
  const metadata = normalizeResumeFileMetadata({
    originalFilename: '../04 Vikram Rao <script>.DOC',
    reportedMimeType: 'application/msword',
  })

  assert.equal(metadata.originalFilename, '04_Vikram_Rao_script.doc')
  assert.equal(metadata.fileExtension, 'doc')
  assert.equal(metadata.normalizedMimeType, 'application/msword')
})

test('resume MIME helpers accept PDF, legacy DOC, DOCX, and TXT identities', () => {
  assert.equal(resolveEffectiveMimeType('application/octet-stream', 'resume.doc'), 'application/msword')
  assert.equal(isAcceptedResumeUpload('application/msword', 'resume.doc'), true)
  assert.equal(isAcceptedResumeUpload('application/octet-stream', 'resume.docx'), true)
  assert.equal(isAcceptedResumeUpload('text/plain', 'resume.txt'), true)
})
