import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./JobsTable.jsx', import.meta.url), 'utf8')

test('job title trigger opens edit modal from button interaction', () => {
  assert.match(source, /className="jobs-table__title-link"/)
  assert.match(source, /onClick=\{\(event\) => onEdit\?\.\(item, event\.currentTarget\)\}/)
  assert.doesNotMatch(source, /href="\/job-descriptions"/)
})
