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
