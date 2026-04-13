import test from 'node:test'
import assert from 'node:assert/strict'
import { appendShortlist, removeShortlistCandidate } from './shortlistState.js'

test('shortlist create prepends and deduplicates by id', () => {
  const next = appendShortlist([{ id: '1', name: 'Existing' }], { id: '2', name: 'New' })
  assert.deepEqual(next.map((item) => item.id), ['2', '1'])
})

test('shortlist remove flow removes only the targeted resume', () => {
  const details = {
    candidates: [
      { resume_id: 'a' },
      { resume_id: 'b' },
    ],
  }

  const next = removeShortlistCandidate(details, 'b')
  assert.deepEqual(next.candidates.map((candidate) => candidate.resume_id), ['a'])
})
