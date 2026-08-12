import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pageSource = readFileSync(new URL('./VerifyEmailInfoPage.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('verification resend keeps the registered account email read-only', () => {
  assert.match(pageSource, /value=\{registeredEmail\}[\s\S]*readOnly[\s\S]*aria-readonly="true"/)
  assert.doesNotMatch(pageSource, /onChange=/)
  assert.match(pageSource, /body: JSON\.stringify\(\{ email: registeredEmail \}\)/)
})

test('pending verification context survives a same-tab refresh', () => {
  assert.match(appSource, /useState\(\(\) => readPendingVerificationEmail\(\)\)/)
  assert.match(appSource, /storePendingVerificationEmail\(email\)/)
  assert.match(pageSource, /No pending verification email was found in this browser tab\./)
})
