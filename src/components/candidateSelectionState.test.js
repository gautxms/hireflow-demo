import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeAllVisibleSelected,
  getSelectedCandidates,
  pruneSelection,
  toggleSelectAllVisible,
  toggleSelection,
} from './candidateSelectionState.js'

const rows = [{ resumeId: 'a' }, { resumeId: 'b' }, { resumeId: 'c' }]
const byResume = (row) => row.resumeId

test('selection toggles one candidate at a time', () => {
  assert.deepEqual(toggleSelection([], 'a'), ['a'])
  assert.deepEqual(toggleSelection(['a', 'b'], 'a'), ['b'])
})

test('bulk selection acts on visible rows only', () => {
  assert.deepEqual(toggleSelectAllVisible(['a'], [{ resumeId: 'b' }, { resumeId: 'c' }], byResume), ['a', 'b', 'c'])
  assert.deepEqual(toggleSelectAllVisible(['a', 'b'], [{ resumeId: 'a' }, { resumeId: 'b' }], byResume), [])
})

test('selected candidates include rows from all filtered pages', () => {
  const selected = getSelectedCandidates(rows, ['a', 'c'], byResume)
  assert.deepEqual(selected.map((row) => row.resumeId), ['a', 'c'])
})

test('selection is pruned when filters change', () => {
  assert.deepEqual(pruneSelection(['a', 'b'], [{ resumeId: 'b' }], byResume), ['b'])
  assert.equal(computeAllVisibleSelected([{ resumeId: 'b' }], ['b'], byResume), true)
})
