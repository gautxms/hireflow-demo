import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./CandidatesPage.jsx', import.meta.url), 'utf8')

test('candidates directory keeps historical persisted reads, filters, pagination, and detail links', () => {
  assert.match(source, /fetch\(`\$\{API_BASE\}\/candidates\/directory/)
  assert.match(source, /buildCandidateDirectoryQueryParams/)
  assert.match(source, /aria-label="Candidates pagination"/)
  assert.match(source, /href=\{`\/candidates\/\$\{candidate\.resumeId\}`\}/)
  assert.match(source, /<CandidateDirectoryScore candidate=\{candidate\}/)
})

test('read-only candidates mode suppresses shortlist selection and mutation UI', () => {
  assert.match(source, /export default function CandidatesPage\(\{ isReadOnly = false \}\)/)
  assert.match(source, /const toggleSelectedCandidate = \(resumeId\) => \{\s*if \(isReadOnly\) return/)
  assert.match(source, /Read-only access: historical candidates remain available/)
  assert.match(source, /\{!isReadOnly && selectedResumeIds\.length > 0 && \(/)
  assert.match(source, /\{!isReadOnly \? <th aria-label="Select candidate" \/> : null\}/)
  assert.match(source, /\{!isReadOnly \? <td>[\s\S]*toggleSelectedCandidate/)
  assert.match(source, /\{!isReadOnly \? <label className="candidates-directory__checkbox"/)
  assert.match(source, /\{!isReadOnly \? <AddToShortlistModal[\s\S]*\/> : null\}/)
})
