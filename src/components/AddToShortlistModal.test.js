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
  assert.match(source, /onChange=\{\(e\) => setNewShortlistName\(e\.target\.value\)\}/)
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
