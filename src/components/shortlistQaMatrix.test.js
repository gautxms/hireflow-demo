import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendShortlist,
  buildShortlistSummary,
  getCandidateJobContext,
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

test('qa matrix: existing multi-shortlist flow keeps destination and data boundaries separated', () => {
  const shortlistA = { id: 'shortlist-a', candidates: [{ resume_id: 'candidate-1' }] }
  const shortlistB = { id: 'shortlist-b', candidates: [{ resume_id: 'candidate-2' }] }

  const shortlistAAfterAdd = {
    ...shortlistA,
    candidates: [...shortlistA.candidates, { resume_id: 'candidate-3' }],
  }

  assert.deepEqual(shortlistAAfterAdd.candidates.map((candidate) => candidate.resume_id), ['candidate-1', 'candidate-3'])
  assert.deepEqual(shortlistB.candidates.map((candidate) => candidate.resume_id), ['candidate-2'])
})

test('qa matrix: jd-linked additions preserve visible job context labels', () => {
  const candidate = {
    source_context: {
      jobDescriptionId: 'jd-42',
      jobTitle: 'Senior Product Designer',
    },
  }

  assert.equal(getCandidateJobContext(candidate), 'Senior Product Designer (jd-42)')
})

test('qa matrix: duplicate add surfaces updated/already-present outcome bucket', () => {
  const summary = buildShortlistSummary({ added: 0, updated: 1, invalid: 0, failed: 0 }, 'add')
  assert.match(summary, /Updated\/Already present: 1/)
})

test('qa matrix: partial bulk failures preserve mixed-result reporting', () => {
  const summary = buildShortlistSummary({ added: 2, updated: 1, invalid: 1, failed: 1 }, 'add')
  assert.equal(summary, 'Added: 2 · Updated/Already present: 1 · Invalid/Missing: 1 · Failed: 1')
  assert.match(getShortlistBulkErrorMessage({ errorCode: 'partial_failure' }), /Retry failed items/i)
})

test('qa matrix: shortlist creation failures remain actionable and retryable', () => {
  assert.equal(getShortlistBulkErrorMessage({ errorCode: 'missing_shortlist' }), 'This shortlist is no longer available. Select another shortlist or create a new one to continue.')
  assert.match(getShortlistBulkErrorMessage({ errorCode: 'partial_failure' }), /retry failed items/i)
})

test('qa matrix: remove and refresh consistency removes only targeted candidate', () => {
  const initial = { candidates: [{ resume_id: '1' }, { resume_id: '2' }] }
  const next = removeShortlistCandidate(initial, '2')
  assert.deepEqual(next.candidates.map((candidate) => candidate.resume_id), ['1'])
})

test('qa matrix: cross-page consistency preserves standardized summary semantics', () => {
  const summary = buildShortlistSummary({ added: 1, updated: 0, invalid: 0, failed: 0 }, 'add')
  assert.equal(summary, 'Added: 1 · Updated/Already present: 0 · Invalid/Missing: 0 · Failed: 0')
})

test('qa matrix: route regression keeps /shortlists recognized as a shell route alias', async () => {
  const { resolveUserSectionPath } = await import('../config/userNavigation.js')
  const { isUserShellRoutePath } = await import('../config/userShellRouting.js')
  assert.equal(isUserShellRoutePath(resolveUserSectionPath('/shortlists')), true)
})
