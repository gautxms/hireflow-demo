import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./JobDescriptionPage.jsx', import.meta.url), 'utf8')

test('jobs page includes analyses-style header and create button opening modal', () => {
  assert.match(source, /className="analyses-page__header"/)
  assert.match(source, />\s*Create Job\s*</)
  assert.match(source, /onClick=\{\(event\) => handleOpenCreate\(event\.currentTarget\)\}/)
})

test('jobs page renders loading, error with retry, empty, and populated table branches', () => {
  assert.match(source, /Loading jobs…/)
  assert.match(source, /analyses-layout__state--error/)
  assert.match(source, /onClick=\{fetchItems\}>Retry<\/button>/)
  assert.match(source, /No jobs yet\. Create your first job to get started\./)
  assert.match(source, /<JobsTable items=\{items\} onEdit=\{handleOpenEdit\} onArchive=\{handleArchive\} archivingId=\{archivingJobId\} \/>/)
})

test('jobs page uses modal create and edit submit paths with success feedback', () => {
  assert.match(source, /<JobModal/)
  assert.match(source, /method: isEdit \? 'PUT' : 'POST'/)
  assert.match(source, /setSuccessMessage\(isEdit \? 'Job updated successfully\.' : 'Job created successfully\.'\)/)
  assert.match(source, /setIsModalOpen\(false\)/)
})


test('jobs page archives instead of forcing hard delete', () => {
  assert.match(source, /const archiveJob = useCallback/)
  assert.match(source, /\$\{API_BASE\}\/job-descriptions\/\$\{item\.id\}/)
  assert.doesNotMatch(source, /hardDelete=true/)
  assert.match(source, /Archive this job\? It will be hidden from active job lists, but historical analyses and candidate results will remain available\./)
  assert.match(source, /Job archived successfully\./)
  assert.doesNotMatch(source, /includeArchived=true/)
})
