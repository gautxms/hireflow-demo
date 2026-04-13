import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldResetAfterSave } from './jobDescriptionSubmissionState.js'

test('shouldResetAfterSave is true only for confirmed create success', () => {
  assert.equal(shouldResetAfterSave({ isEditing: false, payload: { item: { id: 'abc' } } }), true)
  assert.equal(shouldResetAfterSave({ isEditing: true, payload: { item: { id: 'abc' } } }), false)
  assert.equal(shouldResetAfterSave({ isEditing: false, payload: {} }), false)
})
