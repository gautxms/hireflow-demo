import test from 'node:test'
import assert from 'node:assert/strict'
import { clearAutoFilledJobFields, mergeJobDescriptionPreview } from './jobDescriptionPrefill.js'

test('fills supported fields without replacing manual edits or inventing missing work mode', () => {
  const current = { title: 'My title', description: '', skills: '', workMode: '', status: 'draft', experienceMin: '' }
  const manualEdits = new Set(['title'])
  const result = mergeJobDescriptionPreview(current, {
    title: 'AI title',
    description: 'Full JD text',
    skills: ['Node.js', 'PostgreSQL'],
    workMode: null,
    experienceMin: 0,
    status: 'active',
  }, manualEdits)

  assert.equal(result.values.title, 'My title')
  assert.equal(result.values.description, 'Full JD text')
  assert.equal(result.values.skills, 'Node.js, PostgreSQL')
  assert.equal(result.values.experienceMin, '0')
  assert.equal(result.values.workMode, '')
  assert.equal(result.values.status, 'draft')
  assert.deepEqual([...result.autoFilledFields], ['description', 'skills', 'experienceMin'])
})

test('replacing a JD clears only untouched imported values', () => {
  const values = { title: 'First JD title', description: 'First JD text', responsibilities: 'Old duties', location: 'Custom location', status: 'draft' }
  const previousAutoFilled = new Set(['title', 'description', 'responsibilities', 'location'])
  const manualEdits = new Set(['location'])
  const cleared = clearAutoFilledJobFields(values, previousAutoFilled, manualEdits)
  const next = mergeJobDescriptionPreview(cleared, { title: 'Second JD title', description: 'Second JD text', location: 'Mumbai' }, manualEdits)

  assert.equal(next.values.title, 'Second JD title')
  assert.equal(next.values.description, 'Second JD text')
  assert.equal(next.values.responsibilities, '')
  assert.equal(next.values.location, 'Custom location')
  assert.equal(next.values.status, 'draft')
})
