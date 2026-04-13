import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCandidateFilters, normalizeCandidate, sortCandidates } from './results.js'

test('applyCandidateFilters supports search, skills, and numeric ranges', () => {
  const candidates = [
    normalizeCandidate({ name: 'Alice Doe', email: 'alice@example.com', skills: ['React', 'Node'], experience: '6 years', score: 88 }),
    normalizeCandidate({ name: 'Bob Roe', email: 'bob@example.com', skills: ['Python'], experience: '2 years', score: 71 }),
  ]

  const filtered = applyCandidateFilters(candidates, {
    search: 'alice',
    skills: 'react,node',
    experienceMin: '5',
    matchMin: '80',
  })

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].name, 'Alice Doe')
})

test('sortCandidates supports upload date and name modes', () => {
  const candidates = [
    normalizeCandidate({ name: 'Zoe', score: 60, uploadDate: '2024-01-01T00:00:00Z' }),
    normalizeCandidate({ name: 'Amy', score: 99, uploadDate: '2025-01-01T00:00:00Z' }),
  ]

  const nameSorted = sortCandidates(candidates, 'name', 'desc')
  assert.deepEqual(nameSorted.map((candidate) => candidate.name), ['Amy', 'Zoe'])

  const uploadSorted = sortCandidates(candidates, 'upload_date', 'desc')
  assert.deepEqual(uploadSorted.map((candidate) => candidate.name), ['Amy', 'Zoe'])
})
