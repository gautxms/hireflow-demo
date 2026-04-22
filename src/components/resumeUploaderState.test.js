import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL,
  buildChunkInitPayload,
  resolveSelectedJobDescriptionId,
  toOptionalJobDescriptionId,
} from './resumeUploaderState.js'

test('dropdown label exposes Analyze without Job Description option', () => {
  assert.equal(ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL, 'Analyze without Job Description')
})

test('selected JD remains empty when nothing is selected', () => {
  assert.equal(resolveSelectedJobDescriptionId('', [{ id: 'jd-1' }]), '')
  assert.equal(resolveSelectedJobDescriptionId('   ', [{ id: 'jd-1' }]), '')
})

test('chunk payload omits jobDescriptionId when selection is empty', () => {
  const payload = buildChunkInitPayload({
    filename: 'resume.pdf',
    fileSize: 100,
    mimeType: 'application/pdf',
    selectedJobDescriptionId: '',
  })

  assert.deepEqual(payload, {
    filename: 'resume.pdf',
    fileSize: 100,
    mimeType: 'application/pdf',
  })
  assert.equal('jobDescriptionId' in payload, false)
  assert.equal(toOptionalJobDescriptionId(''), undefined)
})
