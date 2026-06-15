import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function readRunnerSource() {
  return readFile(new URL('./runner.js', import.meta.url), 'utf8')
}

test('migration runner includes years_experience decimal migration 031', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'031-make-years-experience-decimal'/)
})

test('migration runner includes AI score cache migration 035', async () => {
  const source = await readRunnerSource()
  assert.match(source, /'035-add-ai-score-cache'/)
})
