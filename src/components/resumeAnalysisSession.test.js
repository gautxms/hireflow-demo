import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFileSnapshot,
  clearResumeAnalysisSession,
  isSessionRecoverable,
  readResumeAnalysisSession,
  writeResumeAnalysisSession,
} from './resumeAnalysisSession.js'

function createStorageMock() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
  }
}

test('resume analysis session restores in-progress parse from localStorage', () => {
  const storage = createStorageMock()
  writeResumeAnalysisSession({
    jobId: 'job-123',
    jobIds: ['job-123', 'job-124'],
    parseStatus: 'processing',
    parseProgress: 37,
    selectedJobDescriptionId: 'jd-1',
    fileSnapshots: [{ name: 'resume.pdf', size: 1234, lastModified: 1, fingerprint: 'resume.pdf::1234::1' }],
  }, storage)

  const session = readResumeAnalysisSession(storage)
  assert.equal(session.jobId, 'job-123')
  assert.deepEqual(session.jobIds, ['job-123', 'job-124'])
  assert.equal(session.parseStatus, 'processing')
  assert.equal(isSessionRecoverable(session), true)
})

test('clear session removes saved state', () => {
  const storage = createStorageMock()
  writeResumeAnalysisSession({ jobId: 'job-124', parseStatus: 'processing' }, storage)
  clearResumeAnalysisSession(storage)
  assert.equal(readResumeAnalysisSession(storage), null)
})

test('buildFileSnapshot preserves retry context fingerprints', () => {
  const snapshot = buildFileSnapshot([
    {
      file: {
        name: 'candidate.docx',
        size: 2048,
        lastModified: 171000,
      },
    },
  ])

  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].fingerprint, 'candidate.docx::2048::171000')
})

test('resume analysis recoverability contract is unchanged for terminal parse states', () => {
  assert.equal(isSessionRecoverable({ jobId: 'job-1', parseStatus: 'processing' }), true)
  assert.equal(isSessionRecoverable({ jobId: 'job-1', parseStatus: 'complete' }), false)
  assert.equal(isSessionRecoverable({ jobId: 'job-1', parseStatus: 'failed' }), false)
  assert.equal(isSessionRecoverable({ jobId: 'job-1', parseStatus: 'cancelled' }), false)
})

test('resume analysis session recovery keeps jobIds fallback behavior', () => {
  const storage = createStorageMock()
  storage.setItem('hireflow_resume_analysis_session_v1', JSON.stringify({
    version: 1,
    jobId: 'job-fallback',
    parseStatus: 'processing',
  }))

  const session = readResumeAnalysisSession(storage)
  assert.deepEqual(session.jobIds, ['job-fallback'])
  assert.equal(isSessionRecoverable(session), true)
})
