import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const source = readFileSync(new URL('./AddToShortlistModal.jsx', import.meta.url), 'utf8')

test('add to shortlist modal keeps selected destination stable while shortlists refresh', () => {
  assert.match(source, /setSelectedShortlistId\(\(current\) => \{[\s\S]*if \(currentId && active\.some\(\(item\) => String\(item\.id\) === currentId\)\) return currentId[\s\S]*return ''[\s\S]*\}\)/)
  assert.doesNotMatch(source, /setSelectedShortlistId\(active\.some\(\(item\) => item\.id === remembered\) \? remembered : ''\)/)
})

test('add to shortlist modal separates create input changes from destination selection', () => {
  assert.match(source, /const \[selectedShortlistId, setSelectedShortlistId\] = useState\(''\)/)
  assert.match(source, /const \[newShortlistName, setNewShortlistName\] = useState\(''\)/)
  assert.match(source, /setNewShortlistName\(e\.target\.value\)/)
  assert.doesNotMatch(source, /onChange=\{\(e\) => \{\s*setNewShortlistName\(e\.target\.value\)[\s\S]*setSelectedShortlistId\(''\)/)
})

test('add to shortlist modal selects newly created shortlist and guards confirm requirements', () => {
  assert.match(source, /setSelectedShortlistId\(createdId\)/)
  assert.match(source, /sessionStorage\.setItem\(SHORTLIST_SESSION_KEY, createdId\)/)
  assert.match(source, /const canConfirm = hasSelectedCandidates && selectedShortlistExists && !isSubmitting && !isLoading/)
})

test('add to shortlist modal protects backdrop and keyboard interactions', () => {
  assert.match(source, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(source, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(source, /event\.key === 'Escape' && !isSubmitting/)
  assert.match(source, /event\.key !== 'Tab'/)
  assert.match(source, /event\.key !== 'Enter'/)
})

test('add to shortlist modal uses structured backend errors and clears them on destination changes', () => {
  assert.match(source, /function buildApiErrorMessage\(payload, fallback\)/)
  assert.match(source, /getShortlistBulkErrorMessage\(payload\)/)
  assert.match(source, /payload\?\.retryGuidance/)
  assert.match(source, /onChange=\{\(e\) => \{ setSelectedShortlistId\(e\.target\.value\); setError\(''\) \}\}/)
  assert.match(source, /\{isSubmitting \? 'Adding…' : 'Confirm add'\}/)
})

test('candidates directory styles do not broadly override modal controls', () => {
  const css = readFileSync(new URL('../styles/candidates-directory.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /\.candidates-directory\s+:is\(input, select, button\)/)
  assert.doesNotMatch(css, /\.candidates-directory\s+button\s*\{/)
  assert.match(css, /\.candidates-directory__toolbar :is\(input, select, button\)/)
})
