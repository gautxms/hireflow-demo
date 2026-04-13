import test from 'node:test'
import assert from 'node:assert/strict'
import { applyOptimisticTagUpdate, applyTagOperation } from './candidateTagState.js'

test('tagging supports add/remove/replace without duplicates', () => {
  assert.deepEqual(applyTagOperation(['hot'], ['new', 'hot'], 'add'), ['hot', 'new'])
  assert.deepEqual(applyTagOperation(['hot', 'new'], ['hot'], 'remove'), ['new'])
  assert.deepEqual(applyTagOperation(['old'], ['fresh'], 'replace'), ['fresh'])
})

test('optimistic tagging returns rollback snapshot', () => {
  const initial = { a: ['alpha'], b: ['beta'] }
  const { next, rollback } = applyOptimisticTagUpdate(initial, ['a', 'b'], ['priority'], 'add')
  assert.deepEqual(next, { a: ['alpha', 'priority'], b: ['beta', 'priority'] })
  assert.deepEqual(rollback, initial)
})
