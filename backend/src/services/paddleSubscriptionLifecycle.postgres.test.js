import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { applyPaddleSubscriptionLifecycle } from './paddleSubscriptionLifecycle.js'
import { canUsePaidMutation } from '../utils/subscriptionAccess.js'

const connectionString = process.env.LIFECYCLE_POSTGRES_TEST_DATABASE_URL

async function createDatabase() {
  const db = new pg.Pool({ connectionString, max: 4 })
  await db.query('DROP TABLE IF EXISTS subscriptions, users CASCADE')
  await db.query(`
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      paddle_customer_id TEXT,
      paddle_subscription_id TEXT,
      paddle_environment TEXT DEFAULT 'production',
      subscription_status TEXT DEFAULT 'inactive',
      subscription_plan TEXT,
      subscription_started_at TIMESTAMP,
      trial_ends_at TIMESTAMP,
      trial_consumed_at TIMESTAMP,
      quota_anchor_at TIMESTAMP,
      current_period_end TIMESTAMP,
      subscription_renewal_date TIMESTAMP,
      next_billing_date TIMESTAMP,
      cancellation_effective_at TIMESTAMP,
      cancellation_reason TEXT,
      last_paddle_event_at TIMESTAMPTZ,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`
    CREATE TABLE subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id),
      paddle_subscription_id TEXT NOT NULL,
      status TEXT NOT NULL,
      latest_event_type TEXT,
      latest_event_payload JSONB,
      paddle_environment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`
    CREATE UNIQUE INDEX subscriptions_environment_id_unique
      ON subscriptions (paddle_environment, paddle_subscription_id)
  `)
  return db
}

function lifecyclePayload({ eventType, status, occurredAt, scheduledChange = null }) {
  return {
    event_id: `evt_${eventType.replaceAll('.', '_')}_${occurredAt}`,
    event_type: eventType,
    occurred_at: occurredAt,
    data: {
      id: 'sub_lifecycle',
      customer_id: 'ctm_lifecycle',
      status,
      scheduled_change: scheduledChange,
      current_billing_period: {
        starts_at: '2026-08-01T00:00:00.000Z',
        ends_at: '2026-09-01T00:00:00.000Z',
      },
      next_billed_at: status === 'canceled' ? null : '2026-09-01T00:00:00.000Z',
      canceled_at: status === 'canceled' ? occurredAt : null,
    },
  }
}

async function apply(db, user, { eventType, status, storedStatus, occurredAt, scheduledChange = null }) {
  const payload = lifecyclePayload({ eventType, status, occurredAt, scheduledChange })
  return applyPaddleSubscriptionLifecycle({
    db,
    user,
    subscriptionId: 'sub_lifecycle',
    customerId: 'ctm_lifecycle',
    environment: 'sandbox',
    eventType,
    status: storedStatus,
    plan: 'monthly',
    providerEventAt: occurredAt,
    payload,
  })
}

async function state(db, userId) {
  const user = (await db.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0]
  const projection = (await db.query(
    `SELECT * FROM subscriptions
     WHERE paddle_environment = 'sandbox' AND paddle_subscription_id = 'sub_lifecycle'`,
  )).rows[0]
  return { user, projection }
}

test('PostgreSQL lifecycle projection is ordered, ownership-safe, and atomic', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const inserted = await db.query(
    `INSERT INTO users (
       email, paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_status, subscription_plan, last_paddle_event_at
     ) VALUES (
       'lifecycle@example.test', 'ctm_lifecycle', 'sub_lifecycle', 'sandbox',
       'active', 'monthly', '2026-08-02T10:00:00.000Z'
     ) RETURNING *`,
  )
  const user = inserted.rows[0]
  await db.query(
    `INSERT INTO subscriptions (
       user_id, paddle_subscription_id, status, latest_event_type,
       latest_event_payload, paddle_environment
     ) VALUES ($1, 'sub_lifecycle', 'active', 'subscription.activated', $2::jsonb, 'sandbox')`,
    [user.id, JSON.stringify({ occurred_at: '2026-08-02T10:00:00.000Z' })],
  )

  const olderPastDue = await apply(db, user, {
    eventType: 'subscription.past_due', status: 'past_due', storedStatus: 'past_due',
    occurredAt: '2026-08-02T09:59:00.000Z',
  })
  assert.equal(olderPastDue.applied, false)

  const pastDue = await apply(db, user, {
    eventType: 'subscription.past_due', status: 'past_due', storedStatus: 'past_due',
    occurredAt: '2026-08-02T10:01:00.000Z',
  })
  assert.equal(pastDue.applied, true)
  let current = await state(db, user.id)
  assert.equal(current.user.subscription_status, 'past_due')
  assert.equal(current.projection.status, 'past_due')
  assert.equal(canUsePaidMutation(current.user), false)

  const staleActive = await apply(db, current.user, {
    eventType: 'subscription.activated', status: 'active', storedStatus: 'active',
    occurredAt: '2026-08-02T10:00:30.000Z',
  })
  assert.equal(staleActive.applied, false)
  current = await state(db, user.id)
  assert.equal(current.user.subscription_status, 'past_due')
  assert.equal(current.projection.status, 'past_due')

  const scheduledAt = '2026-09-01T00:00:00.000Z'
  const scheduled = await apply(db, current.user, {
    eventType: 'subscription.updated', status: 'active', storedStatus: 'active',
    occurredAt: '2026-08-02T10:02:00.000Z',
    scheduledChange: { action: 'cancel', effective_at: scheduledAt },
  })
  assert.equal(scheduled.applied, true)
  current = await state(db, user.id)
  assert.equal(current.user.cancellation_effective_at.toISOString(), scheduledAt)
  assert.equal(canUsePaidMutation(current.user), true)

  const kept = await apply(db, current.user, {
    eventType: 'subscription.updated', status: 'active', storedStatus: 'active',
    occurredAt: '2026-08-02T10:03:00.000Z',
  })
  assert.equal(kept.applied, true)
  current = await state(db, user.id)
  assert.equal(current.user.cancellation_effective_at, null)

  const staleScheduledCancellation = await apply(db, current.user, {
    eventType: 'subscription.updated', status: 'active', storedStatus: 'active',
    occurredAt: '2026-08-02T10:02:30.000Z',
    scheduledChange: { action: 'cancel', effective_at: scheduledAt },
  })
  assert.equal(staleScheduledCancellation.applied, false)
  current = await state(db, user.id)
  assert.equal(current.user.cancellation_effective_at, null)

  await db.query(`
    CREATE FUNCTION reject_lifecycle_projection() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected projection failure';
    END;
    $$ LANGUAGE plpgsql
  `)
  await db.query(`
    CREATE TRIGGER reject_lifecycle_projection
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION reject_lifecycle_projection()
  `)
  await assert.rejects(
    apply(db, current.user, {
      eventType: 'subscription.paused', status: 'paused', storedStatus: 'paused',
      occurredAt: '2026-08-02T10:04:00.000Z',
    }),
    /injected projection failure/,
  )
  current = await state(db, user.id)
  assert.equal(current.user.subscription_status, 'active')
  assert.equal(current.projection.status, 'active')
  await db.query('DROP TRIGGER reject_lifecycle_projection ON subscriptions')
  await db.query('DROP FUNCTION reject_lifecycle_projection()')

  assert.equal((await apply(db, current.user, {
    eventType: 'subscription.paused', status: 'paused', storedStatus: 'paused',
    occurredAt: '2026-08-02T10:04:00.000Z',
  })).applied, true)
  current = await state(db, user.id)
  assert.equal(current.user.subscription_status, 'paused')
  assert.equal(current.projection.status, 'paused')
  assert.equal(canUsePaidMutation(current.user), false)

  assert.equal((await apply(db, current.user, {
    eventType: 'subscription.resumed', status: 'active', storedStatus: 'active',
    occurredAt: '2026-08-02T10:05:00.000Z',
  })).applied, true)
  current = await state(db, user.id)
  assert.equal(current.user.subscription_status, 'active')
  assert.equal(current.projection.status, 'active')
  assert.equal(canUsePaidMutation(current.user), true)

  const olderPause = await apply(db, current.user, {
    eventType: 'subscription.paused', status: 'paused', storedStatus: 'paused',
    occurredAt: '2026-08-02T10:04:30.000Z',
  })
  assert.equal(olderPause.applied, false)
  current = await state(db, user.id)
  assert.equal(current.user.subscription_status, 'active')

  const wrongCustomer = await applyPaddleSubscriptionLifecycle({
    db,
    user: current.user,
    subscriptionId: 'sub_lifecycle',
    customerId: 'ctm_foreign',
    environment: 'sandbox',
    eventType: 'subscription.updated',
    status: 'paused',
    plan: 'monthly',
    providerEventAt: '2026-08-02T10:05:10.000Z',
    payload: lifecyclePayload({
      eventType: 'subscription.updated', status: 'paused', occurredAt: '2026-08-02T10:05:10.000Z',
    }),
  })
  assert.equal(wrongCustomer.applied, false)

  const wrongSubscriptionPayload = lifecyclePayload({
    eventType: 'subscription.updated', status: 'paused', occurredAt: '2026-08-02T10:05:20.000Z',
  })
  wrongSubscriptionPayload.data.id = 'sub_foreign'
  const wrongSubscription = await applyPaddleSubscriptionLifecycle({
    db,
    user: current.user,
    subscriptionId: 'sub_foreign',
    customerId: 'ctm_lifecycle',
    environment: 'sandbox',
    eventType: 'subscription.updated',
    status: 'paused',
    plan: 'monthly',
    providerEventAt: wrongSubscriptionPayload.occurred_at,
    payload: wrongSubscriptionPayload,
  })
  assert.equal(wrongSubscription.applied, false)

  assert.equal((await apply(db, current.user, {
    eventType: 'subscription.canceled', status: 'canceled', storedStatus: 'cancelled',
    occurredAt: '2026-08-02T10:06:00.000Z',
  })).applied, true)
  current = await state(db, user.id)
  assert.equal(current.user.subscription_status, 'cancelled')
  assert.equal(current.projection.status, 'cancelled')
  assert.equal(canUsePaidMutation(current.user), false)

  assert.equal((await apply(db, current.user, {
    eventType: 'subscription.activated', status: 'active', storedStatus: 'active',
    occurredAt: '2026-08-02T10:05:30.000Z',
  })).applied, false)
  current = await state(db, user.id)
  assert.equal(current.user.subscription_status, 'cancelled')
  assert.equal(current.projection.status, 'cancelled')

  const duplicate = await apply(db, current.user, {
    eventType: 'subscription.canceled', status: 'canceled', storedStatus: 'cancelled',
    occurredAt: '2026-08-02T10:06:00.000Z',
  })
  assert.equal(duplicate.applied, false)

  const wrongEnvironment = await applyPaddleSubscriptionLifecycle({
    db,
    user: current.user,
    subscriptionId: 'sub_lifecycle',
    customerId: 'ctm_lifecycle',
    environment: 'production',
    eventType: 'subscription.updated',
    status: 'active',
    plan: 'monthly',
    providerEventAt: '2026-08-02T10:07:00.000Z',
    payload: lifecyclePayload({
      eventType: 'subscription.updated', status: 'active', occurredAt: '2026-08-02T10:07:00.000Z',
    }),
  })
  assert.equal(wrongEnvironment.applied, false)
})

test('PostgreSQL lifecycle projection cannot grant a second trial from a new subscription', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const inserted = await db.query(
    `INSERT INTO users (
       email, paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_status, subscription_plan, trial_consumed_at,
       cancellation_effective_at, last_paddle_event_at
     ) VALUES (
       'consumed-trial@example.test', 'ctm_lifecycle', 'sub_cancelled', 'sandbox',
       'cancelled', 'monthly', '2026-07-01T00:00:00.000Z',
       '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'
     ) RETURNING *`,
  )
  const payload = lifecyclePayload({
    eventType: 'subscription.trialing', status: 'trialing', occurredAt: '2026-08-02T11:00:00.000Z',
  })
  payload.data.id = 'sub_new_trial'

  const result = await applyPaddleSubscriptionLifecycle({
    db,
    user: inserted.rows[0],
    subscriptionId: 'sub_new_trial',
    customerId: 'ctm_lifecycle',
    environment: 'sandbox',
    eventType: 'subscription.trialing',
    status: 'trialing',
    plan: 'monthly',
    providerEventAt: payload.occurred_at,
    payload,
  })

  assert.equal(result.applied, false)
  const current = (await db.query('SELECT * FROM users WHERE id = $1', [inserted.rows[0].id])).rows[0]
  assert.equal(current.subscription_status, 'cancelled')
  assert.equal(current.paddle_subscription_id, 'sub_cancelled')
  assert.notEqual(current.trial_consumed_at, null)
})
