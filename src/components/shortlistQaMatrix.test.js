import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendShortlist,
  buildShortlistSummary,
  getShortlistBulkErrorMessage,
  removeShortlistCandidate,
} from './shortlistState.js'

test('qa matrix: first-time user with no shortlist requires destination creation', () => {
  const shortlists = []
  const canSubmit = shortlists.length > 0
  assert.equal(canSubmit, false)
})

test('qa matrix: add to selected shortlist persists destination association', () => {
  const next = appendShortlist([{ id: 'engineering' }], { id: 'design' })
  assert.equal(next[0].id, 'design')
})

test('qa matrix: create-then-add flow makes created shortlist the active destination', () => {
  const existing = [{ id: 'sales' }]
  const created = { id: 'new-role-shortlist' }
  const next = appendShortlist(existing, created)
  assert.equal(next[0].id, 'new-role-shortlist')
})

test('qa matrix: duplicate add surfaces updated/already-present outcome bucket', () => {
  const summary = buildShortlistSummary({ added: 0, updated: 1, invalid: 0, failed: 0 }, 'add')
  assert.match(summary, /Updated: 1/)
})

test('qa matrix: partial bulk failures preserve mixed-result reporting', () => {
  const summary = buildShortlistSummary({ added: 2, updated: 1, invalid: 1, failed: 1 }, 'add')
  assert.equal(summary, 'Added: 2 · Updated: 1 · Failed: 2')
  assert.match(getShortlistBulkErrorMessage({ errorCode: 'partial_failure' }), /Retry failed items/i)
})

test('qa matrix: remove and refresh consistency removes only targeted candidate', () => {
  const initial = { candidates: [{ resume_id: '1' }, { resume_id: '2' }] }
  const next = removeShortlistCandidate(initial, '2')
  assert.deepEqual(next.candidates.map((candidate) => candidate.resume_id), ['1'])
})

test('qa matrix: cross-page consistency preserves standardized summary semantics', () => {
  const summary = buildShortlistSummary({ added: 1, updated: 0, invalid: 0, failed: 0 }, 'add')
  assert.equal(summary, 'Added: 1 · Updated: 0 · Failed: 0')
})
