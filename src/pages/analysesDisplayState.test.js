import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveDisplayStatus, mergeInFlightAnalyses, mergeInFlightAnalysis } from './analysesDisplayState.js'

const overlay = (expectedFileCount = 2) => ({
  analysisId: 'analysis-1',
  expectedFileCount,
  expectedFiles: Array.from({ length: expectedFileCount }, (_, index) => ({
    filename: `resume-${index + 1}.pdf`,
    status: 'processing',
  })),
})

test('in-flight overlay preserves expected count when server returns partial upload chunks', () => {
  const merged = mergeInFlightAnalysis({
    id: 'analysis-1',
    name: 'Role search',
    status: 'pending',
    liveStatus: 'pending',
    fileCount: 1,
    summary: { total: 1, complete: 0, failed: 0, processing: 1, pending: 0 },
    files: [{ filename: 'resume-1.pdf', status: 'processing' }],
    filesPreview: [{ filename: 'resume-1.pdf', status: 'processing' }],
  }, overlay(2))

  assert.equal(merged.fileCount, 2)
  assert.equal(merged.summary.total, 2)
  assert.equal(merged.filesPreview.length, 2)
  assert.equal(deriveDisplayStatus(merged), 'processing')
})

test('in-flight overlay does not allow temporary server overcount to override expected count', () => {
  const merged = mergeInFlightAnalysis({
    id: 'analysis-1',
    status: 'processing',
    liveStatus: 'processing',
    fileCount: 3,
    summary: { total: 3, complete: 0, failed: 0, processing: 3, pending: 0 },
    files: [
      { filename: 'resume-1.pdf', status: 'processing' },
      { filename: 'resume-2.pdf', status: 'processing' },
      { filename: 'resume-2.pdf', status: 'processing' },
    ],
    filesPreview: [{ filename: 'resume-1.pdf', status: 'processing' }],
  }, overlay(2))

  assert.equal(merged.fileCount, 2)
  assert.equal(merged.summary.total, 2)
  assert.equal(merged.summary.complete + merged.summary.failed + merged.summary.processing + merged.summary.pending, 2)
  assert.equal(deriveDisplayStatus(merged), 'processing')
})

test('in-flight overlay uses expected count when server initially returns fewer files', () => {
  const merged = mergeInFlightAnalysis({
    id: 'analysis-1',
    status: 'pending',
    liveStatus: 'pending',
    fileCount: 1,
    summary: { total: 1, complete: 0, failed: 0, processing: 0, pending: 1 },
  }, overlay(3))

  assert.equal(merged.fileCount, 3)
  assert.equal(merged.summary.total, 3)
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
  }, overlay(2))

  assert.equal(deriveDisplayStatus(merged), 'complete')
  assert.equal(merged.liveStatus, 'complete')
  assert.equal(merged.fileCount, 2)
})

test('terminal failed state wins over in-flight processing overlay', () => {
  const merged = mergeInFlightAnalysis({
    id: 'analysis-1',
    status: 'failed',
    liveStatus: 'failed',
    fileCount: 2,
    summary: { total: 2, complete: 0, failed: 2, processing: 0, pending: 0 },
  }, overlay(2))

  assert.equal(deriveDisplayStatus(merged), 'failed')
  assert.equal(merged.liveStatus, 'failed')
})

test('deleted in-flight analysis does not reappear when overlay is removed', () => {
  const merged = mergeInFlightAnalyses([], {})

  assert.deepEqual(merged, [])
})
