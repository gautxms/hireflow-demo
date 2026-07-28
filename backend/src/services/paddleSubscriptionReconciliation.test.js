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

test('reconciliation does not overwrite a concurrent webhook state change', async () => {
  const mock = dbMock({ userUpdateRowCount: 0 })
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
})
