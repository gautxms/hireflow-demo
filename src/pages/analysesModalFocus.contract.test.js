import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const analysesSource = await readFile(new URL('./AnalysesPage.jsx', import.meta.url), 'utf8')
const modalSource = analysesSource.slice(analysesSource.indexOf('function CreateAnalysisModal'))

test('create analysis modal only applies initial focus when its open state changes', () => {
  assert.match(
    modalSource,
    /nameInputRef\.current\?\.focus\(\)[\s\S]{0,100}\}, \[isOpen, nameInputRef\]\)/,
  )
  assert.doesNotMatch(modalSource, /\[isOpen, isSubmitting, onClose, nameInputRef\]/)
})

test('modal close callback remains stable across selected-file updates', () => {
  assert.match(analysesSource, /const resetModal = useCallback\(\(\) => \{[\s\S]*?setSelectedFiles\(\[\]\)[\s\S]*?\}, \[\]\)/)
})

test('keyboard handling remains active without owning autofocus', () => {
  assert.match(
    modalSource,
    /window\.addEventListener\('keydown', handleKeyDown\)[\s\S]{0,150}\}, \[isOpen, isSubmitting, onClose\]\)/,
  )
})
