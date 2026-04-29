import test from 'node:test'
import assert from 'node:assert/strict'
import { waitWithAbort, shouldSkipStateUpdate } from './abortableAsync.js'

test('polling delay aborts cleanly on unmount signal', async () => {
  const controller = new AbortController()
  const pending = waitWithAbort(200, controller.signal)
  controller.abort()

  await assert.rejects(pending, (error) => error.name === 'AbortError')
})

test('state updates are skipped when component is unmounted', () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal(shouldSkipStateUpdate({ mounted: false, signal: controller.signal }), true)
})
