import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPlanChangeCustomData,
  getPlanChangeMetadata,
  isSubscriptionUpdateTransaction,
  recoverFailedPaddlePlanChange,
} from './paddlePlanChangeRecovery.js'

function recoveryMetadata() {
  return getPlanChangeMetadata({
    custom_data: buildPlanChangeCustomData({ userId: 42 }, {
      fromPlan: 'monthly',
      toPlan: 'annual',
      priorStatus: 'active',
      priorCurrentPeriodEnd: '2026-08-20T00:00:00.000Z',
      priorNextBillingDate: '2026-08-20T00:00:00.000Z',
      previousItems: [
        { price: { id: 'pri_monthly' }, quantity: 1 },
        { price: { id: 'pri_addon' }, quantity: 2 },
      ],
      startedAt: '2026-07-20T00:00:00.000Z',
    }),
  })
}

test('plan-change metadata keeps the previous paid entitlement and original items', () => {
  const metadata = recoveryMetadata()

  assert.deepEqual(metadata, {
    fromPlan: 'monthly',
    toPlan: 'annual',
    priorStatus: 'active',
    priorCurrentPeriodEnd: '2026-08-20T00:00:00.000Z',
    priorNextBillingDate: '2026-08-20T00:00:00.000Z',
    priorRenewalDate: null,
    previousItems: [
      { price_id: 'pri_monthly', quantity: 1 },
      { price_id: 'pri_addon', quantity: 2 },
    ],
    startedAt: '2026-07-20T00:00:00.000Z',
    outcome: 'pending',
  })
})

test('subscription update transaction origin is identified separately from renewals', () => {
  assert.equal(isSubscriptionUpdateTransaction({ data: { origin: 'subscription_update' } }), true)
  assert.equal(isSubscriptionUpdateTransaction({ data: { origin: 'subscription_recurring' } }), false)
})

test('failed plan recovery cancels the failed update and restores previous items without billing', async () => {
  const calls = []
  const metadata = recoveryMetadata()
  const request = async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/transactions/txn_failed') return { data: { id: 'txn_failed', status: 'canceled' } }
    if (path === '/subscriptions/sub_123' && options.method === 'PATCH') {
      return { data: { id: 'sub_123', status: 'active', items: [{ price: { id: 'pri_monthly' }, quantity: 1 }] } }
    }
    return {
      data: {
        id: 'sub_123',
        status: calls.length < 4 ? 'past_due' : 'active',
        custom_data: { userId: 42, plan: 'annual' },
        items: [{ price: { id: calls.length < 4 ? 'pri_annual' : 'pri_monthly' }, quantity: 1 }, ...(calls.length < 4 ? [] : [{ price: { id: 'pri_addon' }, quantity: 2 }])],
      },
    }
  }

  const result = await recoverFailedPaddlePlanChange({
    request,
    subscriptionId: 'sub_123',
    transactionId: 'txn_failed',
    metadata,
  })

  assert.deepEqual(result.canceledTransactionIds, ['txn_failed'])
  assert.equal(calls[0].path, '/transactions/txn_failed')
  assert.deepEqual(JSON.parse(calls[0].options.body), { status: 'canceled' })

  const restoreCall = calls.find(({ path, options }) => path === '/subscriptions/sub_123' && options.method === 'PATCH')
  const restoreBody = JSON.parse(restoreCall.options.body)
  assert.deepEqual(restoreBody.items, [
    { price_id: 'pri_monthly', quantity: 1 },
    { price_id: 'pri_addon', quantity: 2 },
  ])
  assert.equal(restoreBody.proration_billing_mode, 'do_not_bill')
  assert.equal(restoreBody.custom_data.plan, 'monthly')
  assert.equal(restoreBody.custom_data.hireflowPlanChange.outcome, 'recovered')
})

test('failed plan recovery rejects when the failed update cannot be canceled', async () => {
  const cancellationError = new Error('transaction cancellation failed')
  let subscriptionReads = 0
  let restoreAttempted = false
  const request = async (path, options = {}) => {
    if (path === '/transactions/txn_failed') throw cancellationError
    if (path === '/subscriptions/sub_123' && options.method === 'PATCH') {
      restoreAttempted = true
      return { data: { id: 'sub_123', status: 'active' } }
    }
    if (path === '/subscriptions/sub_123') {
      subscriptionReads += 1
      return {
        data: {
          id: 'sub_123',
          status: 'active',
          custom_data: { userId: 42, plan: subscriptionReads === 1 ? 'annual' : 'monthly' },
          items: subscriptionReads === 1
            ? [{ price: { id: 'pri_annual' }, quantity: 1 }]
            : [
                { price: { id: 'pri_monthly' }, quantity: 1 },
                { price: { id: 'pri_addon' }, quantity: 2 },
              ],
        },
      }
    }
    throw new Error(`Unexpected request: ${path}`)
  }

  await assert.rejects(
    recoverFailedPaddlePlanChange({
      request,
      subscriptionId: 'sub_123',
      transactionId: 'txn_failed',
      metadata: recoveryMetadata(),
    }),
    cancellationError,
  )
  assert.equal(restoreAttempted, true)
})
