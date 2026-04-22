import test from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT_SAVE_PATH, SYSTEM_PROMPT_TEXTAREA_CLASS } from './adminSystemPromptConfig.js'

test('system prompt save path points to admin system prompt endpoint', () => {
  assert.equal(SYSTEM_PROMPT_SAVE_PATH, '/admin/system-prompt')
})

test('system prompt textarea includes the expected sizing class', () => {
  assert.match(SYSTEM_PROMPT_TEXTAREA_CLASS, /min-h-56/)
})
