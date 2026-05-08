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
})
