import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pageSource = readFileSync(new URL('./JobDescriptionPage.jsx', import.meta.url), 'utf8')
const modalSource = readFileSync(new URL('../components/jobs/JobModal.jsx', import.meta.url), 'utf8')
const listSource = readFileSync(new URL('../components/JobDescriptionList.jsx', import.meta.url), 'utf8')

test('job modal supports create/edit open paths and closes on success', () => {
  assert.match(pageSource, /setModalMode\('create'\)/)
  assert.match(pageSource, /setModalMode\('edit'\)/)
  assert.match(pageSource, /setIsModalOpen\(true\)/)
  assert.match(pageSource, /setIsModalOpen\(false\)/)
  assert.match(pageSource, /await fetchItems\(\)[\s\S]*setIsModalOpen\(false\)/)
})

test('job modal keeps aria dialog semantics and keyboard focus trap', () => {
  assert.match(modalSource, /role="dialog"/)
  assert.match(modalSource, /aria-modal="true"/)
  assert.match(modalSource, /event\.key === 'Escape' && !isSubmitting/)
  assert.match(modalSource, /event\.key !== 'Tab'/)
  assert.ok(modalSource.includes('triggerRef?.current?.focus?.({ preventScroll: true })'))
})

test('job list exposes list semantics and selectable title button', () => {
  assert.match(listSource, /role="list"/)
  assert.match(listSource, /role="listitem"/)
  assert.match(listSource, /className="job-description-list__title-button"/)
  assert.match(listSource, /aria-pressed=\{isSelected\}/)
})

test('job modal restores trigger focus only after close instead of effect cleanup', () => {
  assert.match(modalSource, /wasOpenRef\.current && !isOpen/)
  assert.doesNotMatch(modalSource, /return \(\) => \{ window\.removeEventListener\('keydown', handleKeyDown\); triggerRef\?\.current\?\.focus/)
})
