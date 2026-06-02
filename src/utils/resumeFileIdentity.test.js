import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildResumeFileIdentity,
  resolveResumeDisplayFilename,
  resolveResumeFileType,
  toSafeResumeFailureReason,
} from './resumeFileIdentity.js'

test('buildResumeFileIdentity preserves original filenames with extensions for duplicate base names', () => {
  assert.deepEqual(buildResumeFileIdentity({ originalFilename: 'resume.pdf' }), {
    filename: 'resume.pdf',
    fileType: 'PDF',
    mimeType: '',
    badge: 'PDF',
    hasExtension: true,
  })
  assert.equal(buildResumeFileIdentity({ originalFilename: 'resume.doc' }).filename, 'resume.doc')
  assert.equal(buildResumeFileIdentity({ originalFilename: 'resume.docx' }).filename, 'resume.docx')
})

test('historical extensionless filenames append known extension or show safe MIME/type badge', () => {
  assert.equal(resolveResumeDisplayFilename({ filename: 'resume', fileExtension: 'docx' }), 'resume.docx')
  const identity = buildResumeFileIdentity({ filename: 'resume', originalMimeType: 'application/pdf' })
  assert.equal(identity.filename, 'resume')
  assert.equal(identity.fileType, 'PDF')
  assert.equal(identity.mimeType, 'application/pdf')
  assert.equal(identity.badge, 'application/pdf')
  assert.equal(identity.hasExtension, false)
})

test('resolveResumeFileType safely falls back across extension, MIME, and unknown', () => {
  assert.equal(resolveResumeFileType({ filename: 'resume.txt' }), 'TXT')
  assert.equal(resolveResumeFileType({ originalMimeType: 'application/msword' }), 'DOC')
  assert.equal(resolveResumeFileType({ filename: 'resume' }), 'Unknown')
})

test('toSafeResumeFailureReason maps known failures and redacts raw JSON diagnostics', () => {
  assert.equal(
    toSafeResumeFailureReason('Unsupported legacy .doc file', { filename: 'resume.doc' }),
    'Legacy Word .doc files are not supported. Please upload this resume as DOCX or text-based PDF.',
  )
  assert.equal(
    toSafeResumeFailureReason('mammoth DOCX extract error', { filename: 'resume.docx' }),
    'DOCX text extraction failed. Try regenerating the DOCX with selectable text or upload a text-based PDF.',
  )
  assert.equal(
    toSafeResumeFailureReason('{"error":"stack trace"}', { filename: 'resume.pdf' }),
    'Resume processing failed. Please upload a text-based PDF or DOCX and try again.',
  )
})
