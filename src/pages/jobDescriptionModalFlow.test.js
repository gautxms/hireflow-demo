import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pageSource = readFileSync(new URL('./JobDescriptionPage.jsx', import.meta.url), 'utf8')
const modalSource = readFileSync(new URL('../components/jobs/JobModal.jsx', import.meta.url), 'utf8')

test('job modal supports create/edit open paths and closes on success', () => {
  assert.match(pageSource, /setModalMode\('create'\)/)
  assert.match(pageSource, /setModalMode\('edit'\)/)
  assert.match(pageSource, /setIsModalOpen\(true\)/)
  assert.match(pageSource, /setIsModalOpen\(false\)/)
  assert.match(pageSource, /await fetchItems\(\)[\s\S]*setIsModalOpen\(false\)/)
})

test('job modal handles keyboard close and focus return behavior', () => {
  assert.match(modalSource, /event\.key === 'Escape' && !isSubmitting/)
  assert.match(modalSource, /event\.key !== 'Tab'/)
  assert.ok(modalSource.includes('triggerRef?.current?.focus?.({ preventScroll: true })'))
})

test('job list title opens edit mode trigger', () => {
  const listSource = readFileSync(new URL('../components/JobDescriptionList.jsx', import.meta.url), 'utf8')
  assert.match(listSource, /onEdit\(item, event\.currentTarget\)/)
})
