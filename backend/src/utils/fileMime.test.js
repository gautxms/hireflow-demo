import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getFileExtension,
  isAcceptedResumeUpload,
  resolveEffectiveMimeType,
} from './fileMime.js'

test('getFileExtension returns lowercase extension', () => {
  assert.equal(getFileExtension('Resume.DOCX'), 'docx')
  assert.equal(getFileExtension('resume'), '')
})

test('resolveEffectiveMimeType prefers known resume extensions over reported MIME', () => {
  assert.equal(
    resolveEffectiveMimeType('application/octet-stream', 'resume.docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  assert.equal(resolveEffectiveMimeType('', 'resume.pdf'), 'application/pdf')
  assert.equal(resolveEffectiveMimeType('', 'resume.txt'), 'text/plain')
  assert.equal(
    resolveEffectiveMimeType('application/msword', 'resume.docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  assert.equal(
    resolveEffectiveMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'resume.doc'),
    'application/msword',
  )
})

test('resolveEffectiveMimeType does not broadly infer unknown octet-stream files', () => {
  assert.equal(resolveEffectiveMimeType('application/octet-stream', 'resume.exe'), 'application/octet-stream')
  assert.equal(isAcceptedResumeUpload('application/octet-stream', 'resume.exe'), false)
})

test('accepted upload supports pdf/docx/txt', () => {
  assert.equal(isAcceptedResumeUpload('application/pdf', 'resume.pdf'), true)
  assert.equal(isAcceptedResumeUpload('application/octet-stream', 'resume.docx'), true)
  assert.equal(isAcceptedResumeUpload('', 'resume.txt'), true)
  assert.equal(isAcceptedResumeUpload('text/plain', 'resume.txt'), true)
})

test('accepted upload rejects text/plain without .txt extension', () => {
  assert.equal(isAcceptedResumeUpload('text/plain', 'resume.exe'), false)
  assert.equal(isAcceptedResumeUpload('text/plain', 'resume'), false)
})
