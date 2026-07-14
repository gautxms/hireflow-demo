import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shellSource = readFileSync(new URL('./UserAppShell.jsx', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../AppHeader.jsx', import.meta.url), 'utf8')
const shellStyles = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8')

test('workspace shell renders an accessible read-only notice with recovery action', () => {
  assert.match(shellSource, /isReadOnlyWorkspace = false/)
  assert.match(shellSource, /readOnlyNotice = null/)
  assert.match(shellSource, /aria-label="Read-only workspace access"/)
  assert.match(shellSource, /<LockKeyhole size=\{18\} strokeWidth=\{1\.5\}/)
  assert.match(shellSource, /\{readOnlyNotice\.title\}/)
  assert.match(shellSource, /\{readOnlyNotice\.description\}/)
  assert.match(shellSource, /onNavigate\(readOnlyNotice\.actionPath\)/)
  assert.match(shellSource, /\{readOnlyNotice\.actionLabel\}/)
})

test('workspace header uses the status-specific recovery label and destination', () => {
  assert.match(shellSource, /upgradeLabel=\{readOnlyNotice\?\.actionLabel\}/)
  assert.match(shellSource, /upgradePath=\{readOnlyNotice\?\.actionPath\}/)
  assert.match(headerSource, /showUpgradeCta = true/)
  assert.match(headerSource, /onNavigate\(upgradePath\)/)
  assert.match(headerSource, /\{upgradeLabel\}/)
})

test('read-only notice follows app-shell tokens and responsive layout rules', () => {
  assert.match(shellStyles, /\.user-app-shell__read-only \{[\s\S]*border: 1px solid var\(--hf-lime-border\)/)
  assert.match(shellStyles, /\.user-app-shell__read-only \{[\s\S]*background: var\(--hf-lime-dim\)/)
  assert.match(shellStyles, /\.user-app-shell__read-only-copy \{[\s\S]*font-family: var\(--hf-font-ui\)/)
  assert.match(shellStyles, /@media \(max-width: 767px\) \{[\s\S]*\.user-app-shell__read-only-action \{[\s\S]*width: 100%/)
})
