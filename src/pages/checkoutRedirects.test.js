import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('successful billing and checkout paths route users to the dashboard', async () => {
  const billingSuccess = await readFile(new URL('./BillingSuccess.jsx', import.meta.url), 'utf8')
  const checkout = await readFile(new URL('./Checkout.jsx', import.meta.url), 'utf8')

  assert.match(billingSuccess, /navigate\('\/dashboard'/)
  assert.match(billingSuccess, /Go to dashboard/)
  assert.match(checkout, /persistActiveSubscription\(token, user, '\/dashboard'\)/)
  assert.doesNotMatch(billingSuccess, /navigate\('\/uploader'/)
  assert.doesNotMatch(checkout, /persistActiveSubscription\(token, user, '\/uploader'\)/)
})

test('returning checkout keeps paid-subscription context without redundant trial copy', async () => {
  const checkout = await readFile(new URL('./Checkout.jsx', import.meta.url), 'utf8')

  assert.match(checkout, /Paid subscription/)
  assert.match(checkout, /Restart your subscription/)
  assert.doesNotMatch(checkout, /A new trial will not be applied/)
  assert.doesNotMatch(checkout, /checkout-page__trial-note/)
})
