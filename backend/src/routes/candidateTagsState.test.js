import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTagOperation, mapCandidateTagRows, normalizeTags } from './candidateTagsState.js'

test('normalizeTags trims and deduplicates', () => {
  assert.deepEqual(normalizeTags([' hot ', 'hot', '', null]), ['hot'])
})

test('applyTagOperation supports add/remove/replace', () => {
  assert.deepEqual(applyTagOperation(['a'], ['b', 'a'], 'add'), ['a', 'b'])
  assert.deepEqual(applyTagOperation(['a', 'b'], ['a'], 'remove'), ['b'])
  assert.deepEqual(applyTagOperation(['a', 'b'], ['z'], 'replace'), ['z'])
})


test('mapCandidateTagRows normalizes database rows to the public API contract', () => {
  assert.deepEqual(
    mapCandidateTagRows([
      {
        resume_id: '11111111-1111-4111-8111-111111111111',
        tags: [' priority ', 'priority', 'review'],
      },
      {
        resumeId: '22222222-2222-4222-8222-222222222222',
        tags: ['screen'],
      },
      {
        resume_id: null,
        tags: ['ignored'],
      },
    ]),
    [
      {
        resumeId: '11111111-1111-4111-8111-111111111111',
        tags: ['priority', 'review'],
      },
      {
        resumeId: '22222222-2222-4222-8222-222222222222',
        tags: ['screen'],
      },
    ],
  )
})
