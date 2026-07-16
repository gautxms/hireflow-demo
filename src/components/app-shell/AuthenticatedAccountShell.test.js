import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./AuthenticatedAccountShell.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')

test('account shell hides the redundant plan action on Billing', () => {
  assert.match(source, /const isBillingPage = pathname === '\/billing' \|\| pathname === '\/billing\/'/)
  assert.match(source, /\{!isBillingPage \? \(/)
  assert.match(source, /account-shell-plans[\s\S]*\) : null\}/)
})

test('account shell sends recoverable subscriptions to Billing with contextual copy', () => {
  assert.match(source, /const billingActionPath = requiresBillingRecovery \? '\/billing' : '\/pricing'/)
  assert.match(source, /const billingActionLabel = requiresBillingRecovery \? 'Review billing' : 'View plans'/)
  assert.match(appSource, /<AuthenticatedAccountShell[\s\S]*requiresBillingRecovery=\{requiresBillingRecovery\}/)
})
