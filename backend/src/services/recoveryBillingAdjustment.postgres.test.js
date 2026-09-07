import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../db/client.js'
import {
  createRecoveryAdjustmentForAttempt,
  runRecoveryBillingAdjustments,
} from './recoveryBillingAdjustment.js'

const databaseUrl = process.env.RECOVERY_ADJUSTMENT_POSTGRES_TEST_DATABASE_URL
const postgresTest = databaseUrl ? test : test.skip

test.after(async () => {
  if (databaseUrl) await pool.end()
})

async function resetSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS recovery_billing_adjustments CASCADE;
    DROP TABLE IF EXISTS payment_attempts CASCADE;
    DROP TABLE IF EXISTS users CASCADE;

    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      paddle_customer_id TEXT,
      paddle_subscription_id TEXT,
      paddle_environment TEXT,
      subscription_plan TEXT,
      subscription_status TEXT DEFAULT 'active',
      cancellation_effective_at TIMESTAMP,
      last_paddle_event_at TIMESTAMPTZ,
      current_period_end TIMESTAMP,
      subscription_renewal_date TIMESTAMP,
      next_billing_date TIMESTAMP
    );

    CREATE TABLE payment_attempts (
      id SERIAL PRIMARY KEY,
      transaction_id TEXT UNIQUE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      payload JSONB,
      metadata JSONB,
      paddle_environment TEXT,
      next_retry_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE recovery_billing_adjustments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      paddle_environment TEXT NOT NULL,
      paddle_customer_id TEXT,
      paddle_subscription_id TEXT,
      recovery_transaction_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP,
      captured_at TIMESTAMP DEFAULT NOW(),
      previous_next_billed_at TIMESTAMP,
      target_next_billed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (paddle_environment, recovery_transaction_id)
    );
  `)
}

postgresTest('orphaned recurring recovery is attributed by exact provider identity before adjustment discovery', async (t) => {
  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS recovery_billing_adjustments, payment_attempts, users CASCADE')
  })
  await resetSchema()
  const user = await pool.query(
    `INSERT INTO users (
       paddle_customer_id, paddle_subscription_id, paddle_environment, subscription_plan
     ) VALUES ('ctm_recovery_owner', 'sub_recovery_owner', 'sandbox', 'annual')
     RETURNING id`,
  )
  await pool.query(
    `INSERT INTO payment_attempts (
       transaction_id, user_id, status, payload, metadata, paddle_environment
     ) VALUES ($1, NULL, 'succeeded', $2::jsonb, $3::jsonb, 'sandbox')`,
    [
      'txn_orphaned_recovery',
      JSON.stringify({
        event_type: 'transaction.payment_failed',
        data: {
          id: 'txn_orphaned_recovery',
          origin: 'subscription_recurring',
          customer_id: 'ctm_recovery_owner',
          subscription_id: 'sub_recovery_owner',
        },
      }),
      JSON.stringify({ resolved_by: 'webhook', event: 'transaction.completed' }),
    ],
  )

  const discovered = []
  await runRecoveryBillingAdjustments({
    db: pool,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    candidateUserId: user.rows[0].id,
    candidateTransactionId: 'txn_orphaned_recovery',
    createAdjustment: async (attempt) => discovered.push(attempt),
    processAdjustment: async () => assert.fail('no adjustment should already be due'),
  })

  assert.equal(discovered.length, 1)
  assert.equal(discovered[0].user_id, user.rows[0].id)
  const repaired = await pool.query(
    `SELECT user_id, metadata->>'recovery_attribution' AS recovery_attribution
     FROM payment_attempts WHERE transaction_id='txn_orphaned_recovery'`,
  )
  assert.deepEqual(repaired.rows[0], {
    user_id: user.rows[0].id,
    recovery_attribution: 'verified_provider_identity',
  })
})

postgresTest('ambiguous provider ownership leaves a recovery attempt unattributed', async (t) => {
  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS recovery_billing_adjustments, payment_attempts, users CASCADE')
  })
  await resetSchema()
  await pool.query(
    `INSERT INTO users (paddle_customer_id, paddle_subscription_id, paddle_environment, subscription_plan)
     VALUES
       ('ctm_shared', 'sub_owner_one', 'sandbox', 'annual'),
       ('ctm_shared', 'sub_owner_two', 'sandbox', 'annual')`,
  )
  await pool.query(
    `INSERT INTO payment_attempts (
       transaction_id, user_id, status, payload, metadata, paddle_environment
     ) VALUES ($1, NULL, 'succeeded', $2::jsonb, $3::jsonb, 'sandbox')`,
    [
      'txn_ambiguous_recovery',
      JSON.stringify({
        data: {
          origin: 'subscription_recurring',
          customer_id: 'ctm_shared',
          subscription_id: 'sub_owner_one',
        },
      }),
      JSON.stringify({ resolved_by: 'webhook', event: 'transaction.completed' }),
    ],
  )

  const discovered = []
  await runRecoveryBillingAdjustments({
    db: pool,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    createAdjustment: async (attempt) => discovered.push(attempt),
  })

  assert.deepEqual(discovered, [])
  const attempt = await pool.query(
    `SELECT user_id FROM payment_attempts WHERE transaction_id='txn_ambiguous_recovery'`,
  )
  assert.equal(attempt.rows[0].user_id, null)
})

postgresTest('active account exposes its unresolved failed recurring attempt for authoritative recovery', async (t) => {
  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS recovery_billing_adjustments, payment_attempts, users CASCADE')
  })
  await resetSchema()
  const user = await pool.query(
    `INSERT INTO users (
       paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_plan, subscription_status, cancellation_effective_at
     ) VALUES ('ctm_active_recovery', 'sub_active_recovery', 'sandbox', 'annual', 'active', NULL)
     RETURNING id`,
  )
  await pool.query(
    `INSERT INTO payment_attempts (
       transaction_id, user_id, status, payload, metadata, paddle_environment
     ) VALUES ($1, $2, 'failed', $3::jsonb, '{}'::jsonb, 'sandbox')`,
    [
      'txn_active_unresolved',
      user.rows[0].id,
      JSON.stringify({
        data: {
          origin: 'subscription_recurring',
          customer_id: 'ctm_active_recovery',
          subscription_id: 'sub_active_recovery',
        },
      }),
    ],
  )

  const discovered = []
  await runRecoveryBillingAdjustments({
    db: pool,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    candidateUserId: user.rows[0].id,
    candidateTransactionId: 'txn_active_unresolved',
    createAdjustment: async (attempt) => discovered.push(attempt),
    processAdjustment: async () => assert.fail('no adjustment should already be due'),
  })

  assert.equal(discovered.length, 1)
  assert.equal(discovered[0].status, 'failed')
  assert.equal(discovered[0].user_id, user.rows[0].id)
})

postgresTest('authoritative provider result atomically resolves the failed attempt before adjustment creation', async (t) => {
  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS recovery_billing_adjustments, payment_attempts, users CASCADE')
  })
  await resetSchema()
  const user = await pool.query(
    `INSERT INTO users (
       paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_plan, subscription_status, cancellation_effective_at
     ) VALUES ('ctm_authoritative', 'sub_authoritative', 'sandbox', 'annual', 'active', NULL)
     RETURNING id`,
  )
  const attempt = await pool.query(
    `INSERT INTO payment_attempts (
       transaction_id, user_id, status, payload, metadata, paddle_environment
     ) VALUES ('txn_authoritative', $1, 'failed', $2::jsonb, '{}'::jsonb, 'sandbox')
     RETURNING *`,
    [
      user.rows[0].id,
      JSON.stringify({
        data: {
          origin: 'subscription_recurring',
          customer_id: 'ctm_authoritative',
          subscription_id: 'sub_authoritative',
        },
      }),
    ],
  )

  const adjustment = await createRecoveryAdjustmentForAttempt(attempt.rows[0], {
    db: pool,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    paddle: {
      environment: 'sandbox',
      priceIdsByPlan: { annual: 'pri_annual' },
      noTrialPriceIdsByPlan: {},
      legacyPriceIdsByPlan: {},
    },
    getTransaction: async () => ({
      id: 'txn_authoritative',
      customer_id: 'ctm_authoritative',
      subscription_id: 'sub_authoritative',
      origin: 'subscription_recurring',
      status: 'completed',
      details: { totals: { grand_total: '9900' } },
      payments: [{ id: 'pay_authoritative', status: 'captured', captured_at: '2026-09-07T12:00:00Z' }],
      items: [{ quantity: 1, price: { id: 'pri_annual', billing_cycle: { interval: 'year' } } }],
    }),
    getSubscription: async () => ({
      id: 'sub_authoritative',
      customer_id: 'ctm_authoritative',
      status: 'active',
      scheduled_change: null,
      next_billed_at: '2027-09-01T12:00:00Z',
      items: [{ price: { id: 'pri_annual' } }],
    }),
  })

  assert.equal(adjustment.recovery_transaction_id, 'txn_authoritative')
  const resolved = await pool.query(
    `SELECT status, metadata->>'resolved_by' AS resolved_by,
            metadata->>'transaction_id' AS resolved_transaction_id
     FROM payment_attempts WHERE transaction_id='txn_authoritative'`,
  )
  assert.deepEqual(resolved.rows[0], {
    status: 'succeeded',
    resolved_by: 'authoritative_reconciliation',
    resolved_transaction_id: 'txn_authoritative',
  })
})

postgresTest('cancelled or provider-mismatched failed attempts remain excluded from authoritative recovery', async (t) => {
  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS recovery_billing_adjustments, payment_attempts, users CASCADE')
  })
  await resetSchema()
  const users = await pool.query(
    `INSERT INTO users (
       paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_plan, subscription_status, cancellation_effective_at
     ) VALUES
       ('ctm_cancelled', 'sub_cancelled', 'sandbox', 'annual', 'active', NOW()),
       ('ctm_current', 'sub_current', 'sandbox', 'annual', 'active', NULL)
     RETURNING id, paddle_customer_id`,
  )
  const cancelled = users.rows.find((row) => row.paddle_customer_id === 'ctm_cancelled')
  const mismatched = users.rows.find((row) => row.paddle_customer_id === 'ctm_current')
  await pool.query(
    `INSERT INTO payment_attempts (
       transaction_id, user_id, status, payload, metadata, paddle_environment
     ) VALUES
       ('txn_cancelled', $1, 'failed', $3::jsonb, '{}'::jsonb, 'sandbox'),
       ('txn_mismatched', $2, 'failed', $4::jsonb, '{}'::jsonb, 'sandbox')`,
    [
      cancelled.id,
      mismatched.id,
      JSON.stringify({
        data: {
          origin: 'subscription_recurring',
          customer_id: 'ctm_cancelled',
          subscription_id: 'sub_cancelled',
        },
      }),
      JSON.stringify({
        data: {
          origin: 'subscription_recurring',
          customer_id: 'ctm_previous',
          subscription_id: 'sub_previous',
        },
      }),
    ],
  )

  const discovered = []
  await runRecoveryBillingAdjustments({
    db: pool,
    env: { PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS: 'sandbox' },
    createAdjustment: async (attempt) => discovered.push(attempt),
    processAdjustment: async () => assert.fail('no adjustment should already be due'),
  })

  assert.deepEqual(discovered, [])
})
