import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./JobsTable.jsx', import.meta.url), 'utf8')

test('job title trigger uses analyses link styling and opens edit modal', () => {
  assert.match(source, /className="analyses-layout__title-link analyses-layout__open-link jobs-table__title-link-reset"/)
  assert.match(source, /onClick=\{\(event\) => onEdit\?\.\(item, event\.currentTarget\)\}/)
})

test('jobs table keeps only archive action and removes edit/delete actions', () => {
  assert.match(source, /Archive size=\{16\}/)
  assert.match(source, /aria-label=\{`\$\{archivingId === itemId \? 'Archiving' : 'Archive'\} job/)
  assert.match(source, /jobs-table__action-button/)
  assert.match(source, /jobs-table__action-spinner/)
  assert.doesNotMatch(source, />Archiving…</)
  assert.doesNotMatch(source, />Edit</)
  assert.doesNotMatch(source, /Trash2/)
})

test('jobs table has skills popover and experience/created columns', () => {
  assert.match(source, />Experience</)
  assert.match(source, />Skills</)
  assert.match(source, />Created</)
  assert.match(source, /SkillsPreviewPopover/)
})
