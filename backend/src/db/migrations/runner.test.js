import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('migration runner includes years_experience decimal migration 031', async () => {
  const source = await readFile(new URL('./runner.js', import.meta.url), 'utf8')
  assert.match(source, /'031-make-years-experience-decimal'/)
})
