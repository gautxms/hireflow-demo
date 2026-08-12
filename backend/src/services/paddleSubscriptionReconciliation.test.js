import test from 'node:test'
import assert from 'node:assert/strict'

import {
  inspectPaddleSubscriptionForReconciliation,
  reconcilePaddleSubscriptionState,
} from './paddleSubscriptionReconciliation.js'

function paddle() {
  return {
    environment: 'sandbox',
    priceIdsByPlan: { monthly: 'pri_monthly', annual: 'pri_annual' },
    noTrialPriceIdsByPlan: {},
    legacyPriceIdsByPlan: {},
  }
}

function user(overrides = {}) {
  return {
    id: 30,
    subscription_status: 'active',
    subscription_plan: 'monthly',
    paddle_customer_id: 'ctm_current',
    paddle_subscription_id: 'sub_current',
    paddle_environment: 'sandbox',
    current_period_end: '2026-08-23T00:00:00.000Z',
    subscription_renewal_date: '2026-08-23T00:00:00.000Z',
    next_billing_date: '2026-08-23T00:00:00.000Z',
    cancellation_effective_at: null,
    last_paddle_event_at: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

function subscription(overrides = {}) {
  return {
    id: 'sub_current',
    customer_id: 'ctm_current',
    status: 'active',
    updated_at: '2026-07-28T08:00:00.000Z',
    items: [{ price: { id: 'pri_monthly' } }],
    current_billing_period: {
      starts_at: '2026-07-23T00:00:00.000Z',
      ends_at: '2026-08-23T00:00:00.000Z',
    },
    next_billed_at: '2026-08-23T00:00:00.000Z',
    scheduled_change: null,
    ...overrides,
  }
}

function dbMock({ userUpdateRowCount = 1 } = {}) {
  const calls = []
  let released = false
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params })
      if (/UPDATE users/.test(String(sql))) {
        return { rowCount: userUpdateRowCount, rows: userUpdateRowCount ? [{ id: 30 }] : [] }
      }
      return { rowCount: 1, rows: [] }
    },
    release() {
      released = true
    },
  }

  return {
    calls,
    get released() {
      return released
    },
    db: {
      async connect() {
        return client
      },
    },
  }
}

test('inspection accepts a verified terminal cancellation with no next billing date', () => {
  const result = inspectPaddleSubscriptionForReconciliation({
    user: user(),
    paddle: paddle(),
    paddlePayload: {
      data: subscription({
        status: 'canceled',
        canceled_at: '2026-07-28T08:00:00.000Z',
        current_billing_period: null,
        next_billed_at: null,
        items: [],
      }),
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.providerVerified, true)
  assert.equal(result.snapshot.storedStatus, 'cancelled')
  assert.equal(result.snapshot.currentPeriodEnd, null)
  assert.equal(result.snapshot.nextBillingDate, null)
  assert.equal(result.snapshot.cancellationEffectiveAt, '2026-07-28T08:00:00.000Z')
})

test('inspection accepts scheduled cancellation without inventing a next billing date', () => {
  const result = inspectPaddleSubscriptionForReconciliation({
    user: user(),
    paddle: paddle(),
    paddlePayload: subscription({
      next_billed_at: null,
      scheduled_change: {
        action: 'cancel',
        effective_at: '2026-08-23T00:00:00.000Z',
      },
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.snapshot.storedStatus, 'active')
  assert.equal(result.snapshot.nextBillingDate, null)
  assert.equal(result.snapshot.cancellationEffectiveAt, '2026-08-23T00:00:00.000Z')
})

test('inspection supports verified Past Due and paused provider states', () => {
  for (const status of ['past_due', 'paused']) {
    const result = inspectPaddleSubscriptionForReconciliation({
      user: user(),
      paddle: paddle(),
      paddlePayload: subscription({ status, next_billed_at: null }),
    })

    assert.equal(result.ok, true, status)
    assert.equal(result.snapshot.storedStatus, status)
    assert.equal(result.snapshot.nextBillingDate, null)
  }
})

test('inspection fails closed on environment, ownership, plan, and ordering evidence gaps', () => {
  const cases = [
    {
      expected: 'environment_mismatch',
      currentUser: user({ paddle_environment: 'production' }),
      provider: subscription(),
    },
    {
      expected: 'subscription_ownership_mismatch',
      currentUser: user(),
      provider: subscription({ id: 'sub_other' }),
    },
    {
      expected: 'customer_ownership_mismatch',
      currentUser: user(),
      provider: subscription({ customer_id: 'ctm_other' }),
    },
    {
      expected: 'plan_mismatch',
      currentUser: user(),
      provider: subscription({ items: [{ price: { id: 'pri_annual' } }] }),
    },
    {
      expected: 'provider_timestamp_missing',
      currentUser: user(),
      provider: subscription({ updated_at: null }),
    },
    {
      expected: 'stale_provider_snapshot',
      currentUser: user({ last_paddle_event_at: '2026-07-29T00:00:00.000Z' }),
      provider: subscription(),
    },
  ]

  for (const entry of cases) {
    const result = inspectPaddleSubscriptionForReconciliation({
      user: entry.currentUser,
      paddle: paddle(),
      paddlePayload: entry.provider,
    })
    assert.equal(result.ok, false)
    assert.equal(result.providerVerified, undefined)
    assert.equal(result.reason, entry.expected)
  }
})

test('ownership rejection diagnostics correlate local and provider identity without payloads', async (t) => {
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  const currentUser = user({ subscription_status: 'past_due' })

  const result = await reconcilePaddleSubscriptionState({
    user: currentUser,
    paddle: paddle(),
    paddlePayload: subscription({ customer_id: 'ctm_foreign' }),
    source: 'automatic_scheduler',
  })

  assert.equal(result.reconciled, false)
  assert.equal(result.reason, 'customer_ownership_mismatch')
  assert.deepEqual(warnings, [[
    '[Paddle subscription reconciliation] Provider state was not applied',
    {
      userId: 30,
      environment: 'sandbox',
      localCustomerId: 'ctm_current',
      localSubscriptionId: 'sub_current',
      providerCustomerId: 'ctm_foreign',
      providerSubscriptionId: 'sub_current',
      previousStatus: 'past_due',
      providerStatus: 'active',
      resultingStatus: 'past_due',
      result: 'customer_ownership_mismatch',
      stateChanged: false,
      source: 'automatic_scheduler',
    },
  ]])
  assert.doesNotMatch(JSON.stringify(warnings), /latest_event_payload|authorization|apiKey/i)
})

test('inspection preserves exact-transaction recovery confirmation for Past Due to Active', () => {
  const result = inspectPaddleSubscriptionForReconciliation({
    user: user({ subscription_status: 'past_due' }),
    paddle: paddle(),
    paddlePayload: subscription(),
  })

  assert.equal(result.ok, false)
  assert.equal(result.providerVerified, true)
  assert.equal(result.reason, 'recovery_confirmation_required')
})

test('automatic reconciliation may accept a newer provider-confirmed Active recovery', () => {
  for (const localStatus of ['past_due', 'payment_failed']) {
    const result = inspectPaddleSubscriptionForReconciliation({
      user: user({ subscription_status: localStatus }),
      paddle: paddle(),
      paddlePayload: subscription(),
      allowProviderConfirmedRecovery: true,
    })

    assert.equal(result.ok, true, localStatus)
    assert.equal(result.providerVerified, true, localStatus)
    assert.equal(result.snapshot.storedStatus, 'active', localStatus)
  }
})

test('inspection does not reactivate a fully canceled lifecycle from a conflicting Active snapshot', () => {
  const result = inspectPaddleSubscriptionForReconciliation({
    user: user({
      subscription_status: 'cancelled',
      cancellation_effective_at: '2020-07-28T00:00:00.000Z',
    }),
    paddle: paddle(),
    paddlePayload: subscription(),
  })

  assert.equal(result.ok, false)
  assert.equal(result.providerVerified, true)
  assert.equal(result.reason, 'terminal_lifecycle_cannot_reactivate')
})

test('terminal reconciliation suppresses matching retries even when ingested after cancellation', async () => {
  const mock = dbMock()
  const result = await reconcilePaddleSubscriptionState({
    user: user(),
    paddle: paddle(),
    paddlePayload: subscription({
      status: 'canceled',
      canceled_at: '2026-07-28T08:00:00.000Z',
      current_billing_period: null,
      next_billed_at: null,
      items: [],
    }),
    db: mock.db,
    source: 'test',
  })

  assert.equal(result.reconciled, true)
  assert.equal(result.user.subscription_status, 'cancelled')
  assert.equal(result.user.subscription_renewal_date, null)
  assert.equal(result.user.next_billing_date, null)
  assert.equal(result.user.next_payment_retry_at, null)
  assert.equal(mock.calls[0].sql, 'BEGIN')

  const update = mock.calls.find(({ sql }) => /UPDATE users/.test(sql))
  assert.ok(update)
  assert.equal(update.params[1], 'cancelled')
  assert.equal(update.params[3], true)
  assert.equal(update.params[5], null)
  assert.match(update.sql, /subscription_renewal_date = CASE WHEN \$4::boolean THEN NULL/)
  assert.match(update.sql, /last_paddle_event_at IS NOT DISTINCT FROM \$14::timestamptz/)
  assert.match(update.sql, /\$8::timestamptz >= last_paddle_event_at/)

  const retryUpdate = mock.calls.find(({ sql }) => /UPDATE payment_attempts/.test(sql))
  assert.ok(retryUpdate)
  assert.match(retryUpdate.sql, /next_retry_at = NULL/)
  assert.match(
    retryUpdate.sql,
    /\) = \$3\s+OR \(\s+COALESCE\([\s\S]*?\) IS NULL\s+AND created_at <= \$5::timestamptz\s+\)\s+\)/,
  )
  assert.doesNotMatch(retryUpdate.sql, /\)\s+AND created_at <= \$5::timestamptz\s+AND status/)
  assert.deepEqual(retryUpdate.params.slice(0, 3), [30, 'sandbox', 'sub_current'])
  assert.equal(retryUpdate.params[4], '2026-07-28T08:00:00.000Z')

  const projection = mock.calls.find(({ sql }) => /INSERT INTO subscriptions/.test(sql))
  assert.ok(projection)
  assert.equal(mock.calls.at(-1).sql, 'COMMIT')
  assert.equal(mock.released, true)
})

test('terminal reconciliation suppresses retries when the user projection is already current', async () => {
  const terminalAt = '2026-07-28T08:00:00.000Z'
  const mock = dbMock()
  const result = await reconcilePaddleSubscriptionState({
    user: user({
      subscription_status: 'cancelled',
      current_period_end: null,
      subscription_renewal_date: null,
      next_billing_date: null,
      cancellation_effective_at: terminalAt,
      last_paddle_event_at: terminalAt,
      next_payment_retry_at: '2026-07-29T08:00:00.000Z',
    }),
    paddle: paddle(),
    paddlePayload: subscription({
      status: 'canceled',
      updated_at: terminalAt,
      canceled_at: terminalAt,
      current_billing_period: null,
      next_billed_at: null,
      items: [],
    }),
    db: mock.db,
    source: 'test',
  })

  assert.equal(result.reconciled, true)
  assert.equal(result.user.next_payment_retry_at, null)

  const retryUpdate = mock.calls.find(({ sql }) => /UPDATE payment_attempts/.test(sql))
  assert.ok(retryUpdate)
  assert.match(retryUpdate.sql, /next_retry_at = NULL/)
  assert.deepEqual(retryUpdate.params.slice(0, 3), [30, 'sandbox', 'sub_current'])
  assert.equal(mock.calls.at(-1).sql, 'COMMIT')
  assert.equal(mock.released, true)
})

test('reconciliation repairs scheduled cancellation and keeps next billing null', async () => {
  const mock = dbMock()
  const result = await reconcilePaddleSubscriptionState({
    user: user(),
    paddle: paddle(),
    paddlePayload: subscription({
      next_billed_at: null,
      scheduled_change: {
        action: 'cancel',
        effective_at: '2026-08-23T00:00:00.000Z',
      },
    }),
    db: mock.db,
  })

  assert.equal(result.reconciled, true)
  assert.equal(result.user.subscription_status, 'active')
  assert.equal(result.user.next_billing_date, null)
  assert.equal(result.user.cancellation_effective_at, '2026-08-23T00:00:00.000Z')
  assert.ok(!mock.calls.some(({ sql }) => /UPDATE payment_attempts/.test(sql)))
})

test('reconciliation clears a removed cancellation schedule and repairs billing dates', async () => {
  const mock = dbMock()
  const result = await reconcilePaddleSubscriptionState({
    user: user({
      current_period_end: '2026-08-20T00:00:00.000Z',
      subscription_renewal_date: '2026-08-20T00:00:00.000Z',
      next_billing_date: null,
      cancellation_effective_at: '2026-08-20T00:00:00.000Z',
    }),
    paddle: paddle(),
    paddlePayload: subscription({
      current_billing_period: {
        starts_at: '2026-07-23T00:00:00.000Z',
        ends_at: '2026-08-23T00:00:00.000Z',
      },
      next_billed_at: '2026-08-23T00:00:00.000Z',
      scheduled_change: null,
    }),
    db: mock.db,
    source: 'automatic_scheduler',
  })

  assert.equal(result.reconciled, true)
  assert.equal(result.user.subscription_status, 'active')
  assert.equal(result.user.current_period_end, '2026-08-23T00:00:00.000Z')
  assert.equal(result.user.next_billing_date, '2026-08-23T00:00:00.000Z')
  assert.equal(result.user.cancellation_effective_at, null)
})

test('automatic reconciliation repairs Past Due and trialing drift without changing trial history', async (t) => {
  const infoLogs = []
  t.mock.method(console, 'info', (...args) => infoLogs.push(args))
  for (const entry of [
    { localStatus: 'past_due', providerStatus: 'active' },
    { localStatus: 'trialing', providerStatus: 'active' },
  ]) {
    const mock = dbMock()
    const currentUser = user({
      subscription_status: entry.localStatus,
      trial_consumed_at: '2026-07-01T00:00:00.000Z',
    })
    const result = await reconcilePaddleSubscriptionState({
      user: currentUser,
      paddle: paddle(),
      paddlePayload: subscription({ status: entry.providerStatus }),
      allowProviderConfirmedRecovery: true,
      db: mock.db,
      source: 'automatic_scheduler',
    })

    assert.equal(result.reconciled, true, entry.localStatus)
    assert.equal(result.user.subscription_status, 'active', entry.localStatus)
    assert.equal(result.user.paddle_subscription_id, currentUser.paddle_subscription_id)
    assert.equal(result.user.trial_consumed_at, currentUser.trial_consumed_at)
    assert.ok(!mock.calls.some(({ sql }) => /trial_consumed_at\s*=/.test(sql)))
  }

  const appliedLogs = infoLogs.filter(([message]) => String(message).includes('Applied verified provider state'))
  assert.deepEqual(appliedLogs.map(([, context]) => ({
    previousStatus: context.previousStatus,
    providerStatus: context.providerStatus,
    resultingStatus: context.resultingStatus,
    result: context.result,
    stateChanged: context.stateChanged,
  })), [
    { previousStatus: 'past_due', providerStatus: 'active', resultingStatus: 'active', result: 'updated', stateChanged: true },
    { previousStatus: 'trialing', providerStatus: 'active', resultingStatus: 'active', result: 'updated', stateChanged: true },
  ])
})

test('reconciliation persists a newer provider watermark for an already-current active snapshot', async () => {
  const previousWatermark = '2026-07-28T07:55:00.000Z'
  const providerWatermark = '2026-07-28T08:00:00.000Z'
  const mock = dbMock()
  const result = await reconcilePaddleSubscriptionState({
    user: user({ last_paddle_event_at: previousWatermark }),
    paddle: paddle(),
    paddlePayload: subscription({ updated_at: providerWatermark }),
    db: mock.db,
    source: 'test',
  })

  assert.equal(result.reconciled, true)
  assert.equal(result.user.last_paddle_event_at, providerWatermark)

  const update = mock.calls.find(({ sql }) => /UPDATE users/.test(sql))
  assert.ok(update)
  assert.equal(update.params[7], providerWatermark)
  assert.equal(update.params[13], previousWatermark)
  assert.match(update.sql, /last_paddle_event_at = GREATEST/)
  assert.match(update.sql, /\$8::timestamptz >= last_paddle_event_at/)
  assert.ok(!mock.calls.some(({ sql }) => /UPDATE payment_attempts/.test(sql)))
  assert.equal(mock.calls.at(-1).sql, 'COMMIT')
  assert.equal(mock.released, true)
})

test('reconciliation does not overwrite or misreport a concurrent webhook state change', async (t) => {
  const mock = dbMock({ userUpdateRowCount: 0 })
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  const result = await reconcilePaddleSubscriptionState({
    user: user(),
    paddle: paddle(),
    paddlePayload: subscription({
      status: 'canceled',
      canceled_at: '2026-07-28T08:00:00.000Z',
      current_billing_period: null,
      next_billed_at: null,
      items: [],
    }),
    db: mock.db,
  })

  assert.equal(result.reconciled, false)
  assert.equal(result.reason, 'concurrent_state_change')
  assert.equal(mock.calls.at(-1).sql, 'ROLLBACK')
  assert.ok(!mock.calls.some(({ sql }) => /UPDATE payment_attempts/.test(sql)))
  assert.ok(!mock.calls.some(({ sql }) => /INSERT INTO subscriptions/.test(sql)))
  assert.equal(mock.released, true)
  const raceLog = warnings.find(([message]) => String(message).includes('Concurrent local state change won reconciliation race'))
  assert.equal(raceLog?.[1]?.previousStatus, 'active')
  assert.equal(raceLog?.[1]?.providerStatus, 'canceled')
  assert.equal(raceLog?.[1]?.result, 'concurrent_state_change')
  assert.equal(Object.hasOwn(raceLog?.[1] || {}, 'resultingStatus'), false)
})
