import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./AccountSettingsPage.jsx', import.meta.url), 'utf8')

test('billing settings card has one destination CTA with decoded ampersand copy', () => {
  const billingSection = source.slice(
    source.indexOf('<section className="account-settings-card">\n        <h2 className="type-h2 account-settings-card-title">Billing</h2>'),
    source.indexOf('<section className="account-settings-card">\n        <h2 className="type-h2 account-settings-card-title">Privacy & Data</h2>'),
  )

  assert.match(source, /const billingPrimaryHref = subscriptionState\.isFree \? '\/pricing' : '\/billing'/)
  assert.match(source, /const billingPrimaryLabel = subscriptionState\.isFree \? 'View pricing' : 'Open Billing & Plans'/)
  assert.equal((billingSection.match(/<a className="type-button account-settings-button"/g) || []).length, 1)
  assert.doesNotMatch(billingSection, /Open Billing &amp; Plans/)
  assert.doesNotMatch(billingSection, />\s*\{subscriptionState\.isFree \? 'Compare plan options' : 'Manage plan'\}\s*</)
})
