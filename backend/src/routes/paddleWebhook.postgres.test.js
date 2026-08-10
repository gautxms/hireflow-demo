import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { pool } from '../db/client.js'
import { up as addDurableInbox } from '../db/migrations/050-add-durable-paddle-webhook-inbox.js'
import { up as addRetryScheduling } from '../db/migrations/051-add-paddle-webhook-retry-scheduling.js'
import { up as backfillVerification } from '../db/migrations/052-backfill-paddle-webhook-verification-gap.js'
import {
  persistVerifiedWebhookInboxEvent,
  processStoredPaddleWebhookEvent,
} from './paddleWebhook.js'

const databaseUrl = process.env.PADDLE_WEBHOOK_POSTGRES_TEST_DATABASE_URL
const postgresTest = databaseUrl ? test : test.skip

test.after(async () => {
  if (databaseUrl) await pool.end()
})

process.env.PADDLE_ENVIRONMENT = 'sandbox'
process.env.PADDLE_SANDBOX_WEBHOOK_SECRET = process.env.PADDLE_SANDBOX_WEBHOOK_SECRET || 'postgres-test-secret'
process.env.PADDLE_SANDBOX_MONTHLY_PRICE_ID = process.env.PADDLE_SANDBOX_MONTHLY_PRICE_ID || 'pri_monthly'
process.env.PADDLE_SANDBOX_ANNUAL_PRICE_ID = process.env.PADDLE_SANDBOX_ANNUAL_PRICE_ID || 'pri_annual'
process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED = 'true'

async function resetSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS paddle_webhook_events CASCADE;
    DROP TABLE IF EXISTS paddle_webhook_audit CASCADE;
    DROP TABLE IF EXISTS payment_attempts CASCADE;
    DROP TABLE IF EXISTS subscriptions CASCADE;
    DROP TABLE IF EXISTS events CASCADE;
    DROP TABLE IF EXISTS error_logs CASCADE;
    DROP TABLE IF EXISTS users CASCADE;

    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      paddle_customer_id TEXT,
      paddle_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'inactive',
      subscription_plan TEXT,
      current_period_end TIMESTAMP,
      next_billing_date TIMESTAMP,
      subscription_renewal_date TIMESTAMP,
      cancellation_effective_at TIMESTAMP,
      cancellation_reason TEXT,
      paddle_environment TEXT,
      last_paddle_event_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMP,
      trial_consumed_at TIMESTAMP,
      subscription_started_at TIMESTAMP,
      quota_anchor_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      paddle_subscription_id TEXT NOT NULL,
      paddle_environment TEXT NOT NULL,
      status TEXT NOT NULL,
      latest_event_type TEXT,
      latest_event_payload JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (paddle_environment, paddle_subscription_id)
    );

    CREATE TABLE payment_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id TEXT NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      customer_email TEXT,
      amount BIGINT,
      currency TEXT,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP,
      last_error TEXT,
      payload JSONB,
      metadata JSONB,
      paddle_environment TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE paddle_webhook_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      signature_valid BOOLEAN NOT NULL,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER,
      event_type TEXT,
      timestamp TIMESTAMPTZ,
      metadata JSONB
    );

    CREATE TABLE error_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT,
      context JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)
  await addDurableInbox(pool)
  await addRetryScheduling(pool)
  await backfillVerification(pool)
}

function storedEvent(payload) {
  const rawBody = JSON.stringify(payload)
  return {
    event_id: payload.event_id,
    event_type: payload.event_type,
    payload_hash: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex'),
    payload,
    paddle_environment: 'sandbox',
    verified_at: new Date().toISOString(),
  }
}

postgresTest('failed-payment mutation rolls back atomically, retries, and completes once the fault is removed', async (t) => {
  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS paddle_webhook_events, paddle_webhook_audit, payment_attempts, subscriptions, events, error_logs, users CASCADE')
  })
  await resetSchema()
  const userResult = await pool.query(
    `INSERT INTO users (paddle_environment, subscription_status, subscription_plan)
     VALUES ('sandbox', 'inactive', 'monthly')
     RETURNING id`,
  )
  const userId = userResult.rows[0].id
  const payload = {
    event_id: 'evt_pg_failed_payment_atomicity',
    event_type: 'transaction.payment_failed',
    occurred_at: '2026-08-10T10:00:00.000Z',
    data: {
      id: 'txn_pg_failed_payment_atomicity',
      subscription_id: 'sub_pg_failed_payment_atomicity',
      customer_id: 'ctm_pg_failed_payment_atomicity',
      currency_code: 'USD',
      custom_data: {
        userId,
        plan: 'monthly',
        paddleEnvironment: 'sandbox',
      },
    },
  }
  const event = storedEvent(payload)
  await persistVerifiedWebhookInboxEvent({
    eventId: event.event_id,
    eventType: event.event_type,
    payloadHash: event.payload_hash,
    payload,
    environment: 'sandbox',
  })

  await pool.query(`
    CREATE FUNCTION fail_payment_attempt_insert() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected payment-attempt failure';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER inject_payment_attempt_failure
      BEFORE INSERT ON payment_attempts
      FOR EACH ROW EXECUTE FUNCTION fail_payment_attempt_insert();
  `)

  const failed = await processStoredPaddleWebhookEvent(event)
  assert.equal(failed.outcome, 'failed')
  assert.equal((await pool.query('SELECT subscription_status FROM users WHERE id = $1', [userId])).rows[0].subscription_status, 'inactive')
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM payment_attempts')).rows[0].count, 0)
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM subscriptions')).rows[0].count, 0)
  const retryable = (await pool.query(
    'SELECT status, attempt_count, last_error_message FROM paddle_webhook_events WHERE event_id = $1',
    [event.event_id],
  )).rows[0]
  assert.equal(retryable.status, 'retryable_failed')
  assert.equal(retryable.attempt_count, 1)
  assert.match(retryable.last_error_message, /injected payment-attempt failure/)

  await pool.query('DROP TRIGGER inject_payment_attempt_failure ON payment_attempts; DROP FUNCTION fail_payment_attempt_insert();')
  await pool.query('UPDATE paddle_webhook_events SET next_retry_at = NOW() WHERE event_id = $1', [event.event_id])
  const retried = await processStoredPaddleWebhookEvent(event)
  assert.equal(retried.outcome, 'completed')

  assert.equal((await pool.query('SELECT subscription_status FROM users WHERE id = $1', [userId])).rows[0].subscription_status, 'payment_failed')
  assert.deepEqual(
    (await pool.query('SELECT transaction_id, status FROM payment_attempts')).rows,
    [{ transaction_id: 'txn_pg_failed_payment_atomicity', status: 'failed' }],
  )
  assert.deepEqual(
    (await pool.query('SELECT paddle_subscription_id, status FROM subscriptions')).rows,
    [{ paddle_subscription_id: 'sub_pg_failed_payment_atomicity', status: 'payment_failed' }],
  )
  const completed = (await pool.query(
    'SELECT status, attempt_count FROM paddle_webhook_events WHERE event_id = $1',
    [event.event_id],
  )).rows[0]
  assert.equal(completed.status, 'completed')
  assert.equal(completed.attempt_count, 2)
})

postgresTest('concurrent stored-event processors produce one effective claim and one completion', async (t) => {
  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS paddle_webhook_events, paddle_webhook_audit, payment_attempts, subscriptions, events, error_logs, users CASCADE')
  })
  await resetSchema()
  const payload = {
    event_id: 'evt_pg_worker_claim',
    event_type: 'webhook.test',
    data: { custom_data: { paddleEnvironment: 'sandbox' } },
  }
  const event = storedEvent(payload)
  await persistVerifiedWebhookInboxEvent({
    eventId: event.event_id,
    eventType: event.event_type,
    payloadHash: event.payload_hash,
    payload,
    environment: 'sandbox',
  })

  const results = await Promise.all([
    processStoredPaddleWebhookEvent(event),
    processStoredPaddleWebhookEvent(event),
  ])
  assert.equal(results.filter(({ outcome }) => outcome === 'completed').length, 1)
  assert.equal((await pool.query(
    'SELECT status FROM paddle_webhook_events WHERE event_id = $1',
    [event.event_id],
  )).rows[0].status, 'completed')
  assert.equal((await pool.query(
    'SELECT COUNT(*)::int AS count FROM paddle_webhook_audit WHERE event_type = $1',
    [event.event_type],
  )).rows[0].count, 1)
})
