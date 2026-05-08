import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./JobsTable.jsx', import.meta.url), 'utf8')

test('job title links route to the jobs list path', () => {
  assert.match(source, /href="\/job-descriptions"/)
  assert.doesNotMatch(source, /href=\{`\/jobs\//)
})
