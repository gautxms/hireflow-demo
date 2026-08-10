import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

import { reconcilePaddleSubscriptionState } from './paddleSubscriptionReconciliation.js'
import { runAutomaticPaddleSubscriptionReconciliation } from './paddleSubscriptionReconciliationWorker.js'

const databaseUrl = process.env.PADDLE_RECONCILIATION_POSTGRES_TEST_DATABASE_URL
const { Pool } = pg

function paddle() {
  return {
    environment: 'sandbox',
    apiBaseUrl: 'https://sandbox-api.paddle.com',
    apiKey: 'test-key',
    apiVersion: '1',
    priceIdsByPlan: { monthly: 'pri_monthly', annual: 'pri_annual' },
    noTrialPriceIdsByPlan: {},
    legacyPriceIdsByPlan: {},
  }
}

function providerSubscription(user, overrides = {}) {
  return {
    id: user.paddle_subscription_id,
    customer_id: user.paddle_customer_id,
    status: 'active',
    updated_at: '2026-08-02T00:00:00.000Z',
    items: [{ price: { id: 'pri_monthly' } }],
    current_billing_period: {
      starts_at: '2026-08-01T00:00:00.000Z',
      ends_at: '2026-09-01T00:00:00.000Z',
    },
    next_billed_at: '2026-09-01T00:00:00.000Z',
    scheduled_change: null,
    ...overrides,
  }
}

async function resetSchema(db) {
  await db.query('DROP TABLE IF EXISTS payment_attempts, subscriptions, users CASCADE')
  await db.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      subscription_status TEXT NOT NULL DEFAULT 'inactive',
      subscription_plan TEXT,
      current_period_end TIMESTAMP,
      subscription_renewal_date TIMESTAMP,
      next_billing_date TIMESTAMP,
      cancellation_effective_at TIMESTAMP,
      cancellation_reason TEXT,
      paddle_customer_id TEXT,
      paddle_subscription_id TEXT,
      paddle_environment TEXT,
      last_paddle_event_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMP,
      trial_consumed_at TIMESTAMP,
      last_paddle_reconciliation_attempt_at TIMESTAMPTZ,
      last_paddle_reconciled_at TIMESTAMPTZ,
      deleted_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`
    CREATE TABLE subscriptions (
      id SERIAL PRIMARY KEY,
      paddle_subscription_id TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL,
      latest_event_type TEXT,
      latest_event_payload JSONB,
      paddle_environment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (paddle_environment, paddle_subscription_id)
    )
  `)
  await db.query(`
    CREATE TABLE payment_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      status TEXT,
      next_retry_at TIMESTAMP,
      paddle_environment TEXT,
      payload JSONB,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

async function insertUser(db, suffix, overrides = {}) {
  const result = await db.query(
    `INSERT INTO users (
       subscription_status, subscription_plan, current_period_end,
       subscription_renewal_date, next_billing_date, cancellation_effective_at,
       paddle_customer_id, paddle_subscription_id, paddle_environment,
       last_paddle_event_at, trial_consumed_at
     )
     VALUES ($1, 'monthly', '2026-09-01', '2026-09-01', '2026-09-01', $2,
             $3, $4, 'sandbox', $5, '2026-07-01')
     RETURNING *`,
    [
      overrides.status || 'active',
      overrides.cancellationEffectiveAt || null,
      `ctm_${suffix}`,
      `sub_${suffix}`,
      overrides.lastPaddleEventAt || '2026-08-01T00:00:00.000Z',
    ],
  )
  return result.rows[0]
}

test('PostgreSQL automatic reconciliation is bounded, overlap-safe, and webhook-race safe', {
  skip: !databaseUrl,
}, async (t) => {
  const db = new Pool({ connectionString: databaseUrl })
  t.after(async () => {
    await resetSchema(db)
    await db.end()
  })

  await t.test('real candidate selection enforces the requested batch limit', async () => {
    await resetSchema(db)
    await insertUser(db, 'bounded_1')
    await insertUser(db, 'bounded_2')
    const unselectedUser = await insertUser(db, 'bounded_3')
    let providerCalls = 0
    const summary = await runAutomaticPaddleSubscriptionReconciliation({
      db,
      environments: ['sandbox'],
      batchSize: 2,
      resolveConfig: paddle,
      async loadSubscription({ user }) {
        providerCalls += 1
        return providerSubscription(user)
      },
    })

    assert.equal(summary.selected, 2)
    assert.equal(summary.attempted, 2)
    assert.equal(summary.updated, 2)
    assert.equal(providerCalls, 2)
    const state = await db.query(
      `SELECT id, last_paddle_reconciliation_attempt_at, last_paddle_reconciled_at
       FROM users ORDER BY id`,
    )
    assert.equal(state.rows.filter((row) => row.last_paddle_reconciled_at).length, 2)
    assert.equal(
      state.rows.find((row) => row.id === unselectedUser.id).last_paddle_reconciliation_attempt_at,
      null,
    )
  })

  await t.test('two backend instances cannot reconcile the same account concurrently', async () => {
    await resetSchema(db)
    await insertUser(db, 'overlap')
    let releaseProvider
    let providerStarted
    const providerGate = new Promise((resolve) => { releaseProvider = resolve })
    const started = new Promise((resolve) => { providerStarted = resolve })
    let providerCalls = 0
    const dependencies = {
      db,
      environments: ['sandbox'],
      resolveConfig: paddle,
      async loadSubscription({ user }) {
        providerCalls += 1
        providerStarted()
        await providerGate
        return providerSubscription(user)
      },
    }

    const firstRun = runAutomaticPaddleSubscriptionReconciliation(dependencies)
    await started
    const secondRun = await runAutomaticPaddleSubscriptionReconciliation(dependencies)
    assert.equal(secondRun.overlap_skipped, true)
    releaseProvider()
    const firstSummary = await firstRun

    assert.equal(firstSummary.updated, 1)
    assert.equal(providerCalls, 1)
    assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM subscriptions')).rows[0].count, 1)
  })

  await t.test('a newer webhook mutation wins after reconciliation reads its snapshot', async () => {
    await resetSchema(db)
    const current = await insertUser(db, 'race')
    const snapshot = providerSubscription(current, {
      status: 'canceled',
      updated_at: '2026-08-02T00:00:00.000Z',
      canceled_at: '2026-08-02T00:00:00.000Z',
      current_billing_period: null,
      next_billed_at: null,
      items: [],
    })
    let injectedWebhook = false
    const summary = await runAutomaticPaddleSubscriptionReconciliation({
      db,
      environments: ['sandbox'],
      batchSize: 1,
      resolveConfig: paddle,
      loadSubscription: async () => snapshot,
      async reconcile(args) {
        if (!injectedWebhook) {
          injectedWebhook = true
          await db.query(
            `UPDATE users
             SET subscription_status = 'past_due',
                 last_paddle_event_at = '2026-08-03T00:00:00.000Z'
             WHERE id = $1`,
            [args.user.id],
          )
        }
        return reconcilePaddleSubscriptionState(args)
      },
    })

    assert.equal(summary.updated, 0)
    assert.equal(summary.skipped, 1)
    const state = (await db.query(
      'SELECT subscription_status, last_paddle_event_at FROM users WHERE id = $1',
      [current.id],
    )).rows[0]
    assert.equal(state.subscription_status, 'past_due')
    assert.equal(state.last_paddle_event_at.toISOString(), '2026-08-03T00:00:00.000Z')
    assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM subscriptions')).rows[0].count, 0)
  })
})
