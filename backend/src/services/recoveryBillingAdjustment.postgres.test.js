import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../db/client.js'
import { runRecoveryBillingAdjustments } from './recoveryBillingAdjustment.js'

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
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE recovery_billing_adjustments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      paddle_environment TEXT NOT NULL,
      recovery_transaction_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP,
      captured_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
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
