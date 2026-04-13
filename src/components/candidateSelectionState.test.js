import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeAllVisibleSelected,
  getSelectedCandidates,
  pruneSelection,
  toggleSelectAllVisible,
  toggleSelection,
} from './candidateSelectionState.js'

const rows = [
  { _bulkKey: 'a' },
  { _bulkKey: 'b' },
  { _bulkKey: 'c' },
]

test('selection toggles one candidate at a time', () => {
  assert.deepEqual(toggleSelection([], 'a'), ['a'])
  assert.deepEqual(toggleSelection(['a', 'b'], 'a'), ['b'])
})

test('bulk selection acts on visible rows only', () => {
  assert.deepEqual(toggleSelectAllVisible(['a'], [{ _bulkKey: 'b' }, { _bulkKey: 'c' }]), ['a', 'b', 'c'])
  assert.deepEqual(toggleSelectAllVisible(['a', 'b'], [{ _bulkKey: 'a' }, { _bulkKey: 'b' }]), [])
})

test('selected candidates include rows from all filtered pages', () => {
  const selected = getSelectedCandidates(rows, ['a', 'c'])
  assert.deepEqual(selected.map((row) => row._bulkKey), ['a', 'c'])
})

test('selection is pruned when filters change', () => {
  assert.deepEqual(pruneSelection(['a', 'b'], [{ _bulkKey: 'b' }]), ['b'])
  assert.equal(computeAllVisibleSelected([{ _bulkKey: 'b' }], ['b']), true)
})
