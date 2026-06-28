import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveDisplayStatus, mergeInFlightAnalysis } from './analysesDisplayState.js'

test('in-flight overlay preserves expected count when server returns partial upload chunks', () => {
  const merged = mergeInFlightAnalysis({
    id: 'analysis-1',
    name: 'Role search',
    status: 'pending',
    liveStatus: 'pending',
    fileCount: 1,
    summary: { total: 1, complete: 0, failed: 0, processing: 1, pending: 0 },
    files: [{ filename: 'first.pdf', status: 'processing' }],
    filesPreview: [{ filename: 'first.pdf', status: 'processing' }],
  }, {
    analysisId: 'analysis-1',
    expectedFileCount: 2,
    expectedFiles: [
      { filename: 'first.pdf', status: 'processing' },
      { filename: 'second.pdf', status: 'processing' },
    ],
  })

  assert.equal(merged.fileCount, 2)
  assert.equal(merged.summary.total, 2)
  assert.equal(merged.filesPreview.length, 2)
  assert.equal(deriveDisplayStatus(merged), 'processing')
})

test('pending parse jobs for an active analysis display as processing', () => {
  assert.equal(deriveDisplayStatus({
    status: 'pending',
    liveStatus: 'pending',
    summary: { total: 2, complete: 0, failed: 0, processing: 0, pending: 2 },
  }), 'processing')
})

test('terminal complete state wins over in-flight processing overlay', () => {
  const merged = mergeInFlightAnalysis({
    id: 'analysis-1',
    status: 'complete',
    liveStatus: 'complete',
    fileCount: 2,
    summary: { total: 2, complete: 2, failed: 0, processing: 0, pending: 0 },
  }, {
    analysisId: 'analysis-1',
    expectedFileCount: 2,
    expectedFiles: [
      { filename: 'first.pdf', status: 'processing' },
      { filename: 'second.pdf', status: 'processing' },
    ],
  })

  assert.equal(deriveDisplayStatus(merged), 'complete')
  assert.equal(merged.liveStatus, 'complete')
})
