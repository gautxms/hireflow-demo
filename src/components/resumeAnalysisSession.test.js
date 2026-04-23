import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFileSnapshot,
  clearResumeAnalysisResult,
  clearResumeAnalysisSession,
  getResumeAnalysisOwnerKey,
  isSessionRecoverable,
  readResumeAnalysisResult,
  readResumeAnalysisSession,
  writeResumeAnalysisResult,
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
    parseStatus: 'processing',
    parseProgress: 37,
    selectedJobDescriptionId: 'jd-1',
    fileSnapshots: [{ name: 'resume.pdf', size: 1234, lastModified: 1, fingerprint: 'resume.pdf::1234::1' }],
  }, storage)

  const session = readResumeAnalysisSession(storage)
  assert.equal(session.jobId, 'job-123')
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

test('resume analysis results are scoped to the authenticated account', () => {
  const storage = createStorageMock()
  const ownerA = getResumeAnalysisOwnerKey({ id: 'user-a', email: 'a@example.com' })
  const ownerB = getResumeAnalysisOwnerKey({ id: 'user-b', email: 'b@example.com' })

  writeResumeAnalysisResult({
    candidates: [{ name: 'Alice' }],
    jobId: 'job-1',
  }, ownerA, storage)

  assert.equal(readResumeAnalysisResult(ownerB, storage), null)
  assert.equal(readResumeAnalysisResult(ownerA, storage)?.jobId, 'job-1')
})

test('clearResumeAnalysisResult only clears the active account scope', () => {
  const storage = createStorageMock()
  const ownerA = getResumeAnalysisOwnerKey({ id: 'user-a' })
  const ownerB = getResumeAnalysisOwnerKey({ id: 'user-b' })
  writeResumeAnalysisResult({
    candidates: [{ name: 'Alice' }],
    jobId: 'job-1',
  }, ownerA, storage)

  clearResumeAnalysisResult(ownerB, storage)
  assert.equal(readResumeAnalysisResult(ownerA, storage)?.jobId, 'job-1')

  clearResumeAnalysisResult(ownerA, storage)
  assert.equal(readResumeAnalysisResult(ownerA, storage), null)
})
