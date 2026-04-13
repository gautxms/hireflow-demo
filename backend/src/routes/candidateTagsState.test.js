import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTagOperation, normalizeTags } from './candidateTagsState.js'

test('normalizeTags trims and deduplicates', () => {
  assert.deepEqual(normalizeTags([' hot ', 'hot', '', null]), ['hot'])
})

test('applyTagOperation supports add/remove/replace', () => {
  assert.deepEqual(applyTagOperation(['a'], ['b', 'a'], 'add'), ['a', 'b'])
  assert.deepEqual(applyTagOperation(['a', 'b'], ['a'], 'remove'), ['b'])
  assert.deepEqual(applyTagOperation(['a', 'b'], ['z'], 'replace'), ['z'])
})
