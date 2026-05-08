import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./JobDescriptionPage.jsx', import.meta.url), 'utf8')

test('jobs page includes analyses-style header and create button', () => {
  assert.match(source, /className="analyses-page__header"/)
  assert.match(source, />\s*Create Job\s*</)
  assert.match(source, /onClick=\{\(\) => setIsCreating\(true\)\}/)
})

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
