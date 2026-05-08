import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./JobDescriptionPage.jsx', import.meta.url), 'utf8')

test('jobs page includes accessible status tabs and search label', () => {
  assert.match(source, /role="tablist" aria-label="Job status"/)
  assert.match(source, /role="tab"/)
  assert.match(source, /aria-selected=\{routeState === state\}/)
  assert.match(source, /htmlFor="job-description-search"/)
  assert.match(source, /id="job-description-search"/)
})

test('jobs page keeps refresh and CRUD flows wired to fetchItems', () => {
  assert.match(source, /const fetchItems = useCallback\(async \(\) =>/)
  assert.match(source, /await fetchItems\(\)/)
  assert.match(source, /method: isEditing \? 'PUT' : 'POST'/)
  assert.match(source, /method: 'DELETE'/)
  assert.match(source, /duplicate/)
test('jobs page renders loading, error, empty, and populated table branches', () => {
  assert.match(source, /Loading jobs…/)
  assert.match(source, /analyses-layout__state--error/)
  assert.match(source, /No jobs yet\. Create your first job to get started\./)
  assert.match(source, /<JobsTable[\s\S]*items=\{items\}[\s\S]*onArchive=\{handleArchive\}[\s\S]*onDelete=\{handleDelete\}/)
})

test('jobs page renders the create job form flow when requested', () => {
  assert.match(source, /<JobDescriptionForm[\s\S]*onSubmit=\{handleCreateJob\}[\s\S]*onCancel=\{\(\) => setIsCreating\(false\)\}[\s\S]*isSubmitting=\{isSubmitting\}/)
  assert.match(source, /fetch\(`\$\{API_BASE\}\/job-descriptions`, \{/)
  assert.match(source, /method: 'POST'/)
})

test('jobs page includes archive-first delete confirmations and destructive warning copy', () => {
  assert.match(source, /Archive is recommended/)
  assert.match(source, /Permanently delete/)
  assert.match(source, /linked resumes\/analyses may be affected/i)
  assert.match(source, /window\.confirm/)
})

test('jobs page wires action handlers and surfaces request errors', () => {
  assert.match(source, /onArchive=\{handleArchive\}/)
  assert.match(source, /onDelete=\{handleDelete\}/)
  assert.match(source, /setError\(requestError\.message \|\| 'Unable to delete job description'\)/)
})
