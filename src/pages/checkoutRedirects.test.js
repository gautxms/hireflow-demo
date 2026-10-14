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

test('returning checkout uses canonical canceled-state recognition', async () => {
  const checkout = await readFile(new URL('./Checkout.jsx', import.meta.url), 'utf8')

  assert.match(checkout, /isCanceledSubscription\(subscriptionStatus\)/)
  assert.doesNotMatch(checkout, /subscriptionStatus === 'cancelled'/)
})

test('completed checkout response uses validated correlation before navigation and success sync', async () => {
  const checkout = await readFile(new URL('./Checkout.jsx', import.meta.url), 'utf8')
  const billingSuccess = await readFile(new URL('./BillingSuccess.jsx', import.meta.url), 'utf8')
  assert.match(checkout, /completedCheckoutNavigation\(payload\)/)
  assert.match(checkout, /navigate\(recovery\.path, \{ state: recovery\.state \}\)/)
  assert.match(billingSuccess, /syncCompletedCheckout\(\{[\s\S]*transactionId: transactionId \|\| null,[\s\S]*checkoutReservationId: checkoutReservationId \|\| null,/)
})

test('Paddle completion, close verification, and polling use the validated durable destination', async () => {
  const checkout = await readFile(new URL('./Checkout.jsx', import.meta.url), 'utf8')
  assert.match(checkout, /verifiedCheckoutNavigation\(payload, window\.location\.origin\)/)
  assert.match(checkout, /successUrl: checkoutNavigation\.url/)
  assert.match(checkout, /checkoutTransactionId !== checkoutNavigation\.state\.transactionId/)
  assert.match(checkout, /checkout\.completed[\s\S]*?navigate\(checkoutNavigation\.path, \{ state: checkoutNavigation\.state \}\)/)
  assert.match(checkout, /navigate\(checkoutNavigation\.path, \{ state: \{ \.\.\.checkoutNavigation\.state, message: outcome\.message \} \}\)/)
  assert.match(checkout, /if \(checkoutNavigation\) navigate\(checkoutNavigation\.path/)
  assert.doesNotMatch(checkout, /searchParams\.delete\('_ptxn'\)/)
  assert.doesNotMatch(checkout, /navigate\('\/billing\/success'/)
})
