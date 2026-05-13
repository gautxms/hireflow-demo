import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveResumeFileTypeLabel } from './resumeFileTypeResolver.js'

test('resolveResumeFileTypeLabel prefers candidate mime fields and maps known values', () => {
  assert.equal(resolveResumeFileTypeLabel({ file_type: 'application/pdf', filename: 'resume.docx' }), 'PDF')
  assert.equal(resolveResumeFileTypeLabel({ mimeType: 'application/msword' }), 'DOC')
})

test('resolveResumeFileTypeLabel derives type from extension when mime is missing', () => {
  assert.equal(resolveResumeFileTypeLabel({ sourceFilename: 'candidate_profile.docx' }), 'DOCX')
  assert.equal(resolveResumeFileTypeLabel({ original_filename: 'candidate.txt' }), 'TXT')
})

test('resolveResumeFileTypeLabel falls back to FILE when type and extension are missing', () => {
  assert.equal(resolveResumeFileTypeLabel({ filename: 'resume' }), 'FILE')
  assert.equal(resolveResumeFileTypeLabel({}), 'FILE')
})
