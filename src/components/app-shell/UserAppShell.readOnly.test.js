import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shellSource = readFileSync(new URL('./UserAppShell.jsx', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../AppHeader.jsx', import.meta.url), 'utf8')
const shellStyles = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8')

test('workspace shell consolidates read-only guidance into the header', () => {
  assert.match(shellSource, /readOnlyNotice = null/)
  assert.match(shellSource, /upgradeStatusLabel=\{readOnlyNotice\?\.title\}/)
  assert.match(shellSource, /upgradeDescription=\{readOnlyNotice\?\.description\}/)
  assert.doesNotMatch(shellSource, /user-app-shell__read-only/)
  assert.doesNotMatch(shellSource, /LockKeyhole/)
})

test('workspace header uses the status-specific recovery label and destination', () => {
  assert.match(shellSource, /upgradeLabel=\{readOnlyNotice\?\.actionLabel\}/)
  assert.match(shellSource, /upgradePath=\{readOnlyNotice\?\.actionPath\}/)
  assert.match(headerSource, /showUpgradeCta = true/)
  assert.match(headerSource, /const upgradeStatus = upgradeStatusLabel/)
  assert.match(headerSource, /aria-label=\{upgradeDescription \? `\$\{upgradeStatus\}\. \$\{upgradeDescription\}` : upgradeStatus\}/)
  assert.match(headerSource, /onNavigate\(upgradePath\)/)
  assert.match(headerSource, /\{upgradeLabel\}/)
})

test('legacy full-width read-only banner styles are removed', () => {
  assert.doesNotMatch(shellStyles, /\.user-app-shell__read-only/)
})
