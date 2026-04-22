import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getSystemPromptSourceLabel,
  LOCAL_FALLBACK_SYSTEM_PROMPT,
  getSystemPromptSaveErrorMessage,
  SYSTEM_PROMPT_RESET_PATH,
  SYSTEM_PROMPT_SAVE_PATH,
  SYSTEM_PROMPT_TEXTAREA_CLASS,
} from './adminSystemPromptConfig.js'

test('system prompt save path points to admin system prompt endpoint', () => {
  assert.equal(SYSTEM_PROMPT_SAVE_PATH, '/admin/system-prompt')
})

test('system prompt reset path points to admin reset endpoint', () => {
  assert.equal(SYSTEM_PROMPT_RESET_PATH, '/admin/system-prompt/reset')
})

test('system prompt textarea includes the expected sizing class', () => {
  assert.match(SYSTEM_PROMPT_TEXTAREA_CLASS, /min-h-\[24rem\]/)
  assert.match(SYSTEM_PROMPT_TEXTAREA_CLASS, /resize-y/)
})

test('system prompt save error helper prefers API payload details when error field is unavailable', () => {
  const error = {
    payload: {
      details: '42P18',
    },
  }

  assert.equal(getSystemPromptSaveErrorMessage(error), '42P18')
  assert.equal(getSystemPromptSaveErrorMessage({ payload: { error: 'Database query issue.' } }), 'Database query issue.')
  assert.equal(getSystemPromptSaveErrorMessage({}), 'Unable to save system prompt.')
})

test('local fallback system prompt is non-empty and source labels are explicit', () => {
  assert.ok(LOCAL_FALLBACK_SYSTEM_PROMPT.length > 0)
  assert.equal(getSystemPromptSourceLabel({ isDefaultFallback: false }), 'Loaded from DB')
  assert.equal(getSystemPromptSourceLabel({ isDefaultFallback: true }), 'Using fallback default')
})
