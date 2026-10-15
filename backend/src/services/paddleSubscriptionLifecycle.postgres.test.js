import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { applyPaddleSubscriptionLifecycle } from './paddleSubscriptionLifecycle.js'
import { canUsePaidMutation } from '../utils/subscriptionAccess.js'
import { resolveMonthlyResumeAnalysisLimit } from '../config/resumeAnalysisQuota.js'
import { resolveResumeQuotaPeriod } from '../utils/resumeQuotaPeriod.js'
import { persistVerifiedCheckoutSubscription } from '../routes/paddleCheckout.js'

const connectionString = process.env.LIFECYCLE_POSTGRES_TEST_DATABASE_URL

async function createDatabase() {
  const db = new pg.Pool({ connectionString, max: 4 })
  await db.query('DROP TABLE IF EXISTS usage_log, paddle_checkout_reservations, subscriptions, users CASCADE')
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
  await db.query(`
    CREATE TABLE paddle_checkout_reservations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reservation_token UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id BIGINT REFERENCES users(id),
      paddle_environment TEXT NOT NULL,
      requested_plan TEXT NOT NULL,
      stored_plan TEXT NOT NULL,
      price_id TEXT NOT NULL,
      trial_eligible BOOLEAN NOT NULL,
      checkout_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      paddle_transaction_id TEXT,
      paddle_customer_id TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`
    CREATE TABLE usage_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id),
      ip_address TEXT NOT NULL,
      month_start DATE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
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

test('trial conversion starts the paid monthly allowance at the paid billing period', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const inserted = await db.query(
    `INSERT INTO users (
       email, paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_status, subscription_plan, subscription_started_at,
       trial_ends_at, trial_consumed_at, quota_anchor_at, current_period_end,
       last_paddle_event_at
     ) VALUES (
       'conversion@example.test', 'ctm_lifecycle', 'sub_lifecycle', 'sandbox',
       'trialing', 'starter_monthly', '2026-08-01T00:00:00.000Z',
       '2026-08-08T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
       '2026-08-01T00:00:00.000Z', '2026-08-08T00:00:00.000Z',
       '2026-08-01T00:00:00.000Z'
     ) RETURNING *`,
  )
  const payload = lifecyclePayload({
    eventType: 'subscription.updated', status: 'active', occurredAt: '2026-08-08T00:00:01.000Z',
  })
  payload.data.current_billing_period.starts_at = '2026-08-08T00:00:00.000Z'
  payload.data.current_billing_period.ends_at = '2026-09-08T00:00:00.000Z'
  payload.data.next_billed_at = '2026-09-08T00:00:00.000Z'

  const result = await applyPaddleSubscriptionLifecycle({
    db, user: inserted.rows[0], subscriptionId: 'sub_lifecycle', customerId: 'ctm_lifecycle',
    environment: 'sandbox', eventType: 'subscription.updated', status: 'active',
    plan: 'starter_monthly', providerEventAt: payload.occurred_at, payload,
  })

  assert.equal(result.applied, true)
  const updated = (await db.query('SELECT subscription_status, quota_anchor_at FROM users WHERE id = $1', [inserted.rows[0].id])).rows[0]
  assert.equal(updated.subscription_status, 'active')
  assert.equal(updated.quota_anchor_at.toISOString(), '2026-08-08T00:00:00.000Z')
})

test('a verified new paid lifecycle starts fresh without deleting historical usage', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const reservationToken = '42d85541-3b0e-4b1a-8dca-2525950fbaf0'
  const inserted = await db.query(
    `INSERT INTO users (
       email, paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_status, subscription_plan, trial_consumed_at, quota_anchor_at,
       current_period_end, cancellation_effective_at, last_paddle_event_at
     ) VALUES (
       'fresh-growth@example.test', 'ctm_growth', 'sub_old_pro', 'sandbox',
       'cancelled', 'pro_monthly', '2026-01-01T00:00:00.000Z',
       '2026-09-14T09:00:00.000Z', '2026-10-14T09:00:00.000Z',
       '2026-10-14T09:00:00.000Z', '2026-10-14T09:00:00.000Z'
     ) RETURNING *`,
  )
  const user = inserted.rows[0]
  await db.query(
    `INSERT INTO paddle_checkout_reservations (
       reservation_token, user_id, paddle_environment, requested_plan, stored_plan,
       price_id, trial_eligible, checkout_mode, status, paddle_transaction_id, paddle_customer_id
     ) VALUES ($1::uuid, $2, 'sandbox', 'growth_annual', 'growth_annual',
               'pri_growth_annual_paid', FALSE, 'paid_returning', 'ready',
               'txn_growth_annual', 'ctm_growth')`,
    [reservationToken, user.id],
  )
  for (let index = 0; index < 7; index += 1) {
    await db.query(
      `INSERT INTO usage_log (user_id, ip_address, month_start, created_at)
       VALUES ($1, '127.0.0.1', '2026-09-14', $2::timestamp)`,
      [user.id, `2026-10-14T08:5${index}:00.000Z`],
    )
  }
  const payload = {
    event_id: 'evt_new_growth_annual',
    event_type: 'subscription.activated',
    occurred_at: '2026-10-15T09:00:01.000Z',
    data: {
      id: 'sub_new_growth_annual',
      customer_id: 'ctm_growth',
      status: 'active',
      items: [{ price: { id: 'pri_growth_annual_paid' }, quantity: 1 }],
      custom_data: {
        userId: user.id,
        checkoutReservationId: reservationToken,
        requestedPlan: 'growth_annual',
        plan: 'growth_annual',
        paddleEnvironment: 'sandbox',
        checkoutMode: 'paid_returning',
        trialEligible: false,
      },
      current_billing_period: {
        starts_at: '2026-10-15T09:00:00.000Z',
        ends_at: '2027-10-15T09:00:00.000Z',
      },
      next_billed_at: '2027-10-15T09:00:00.000Z',
    },
  }

  const activated = await applyPaddleSubscriptionLifecycle({
    db,
    user,
    subscriptionId: 'sub_new_growth_annual',
    customerId: 'ctm_growth',
    environment: 'sandbox',
    eventType: 'subscription.activated',
    status: 'active',
    plan: 'growth_annual',
    priceId: 'pri_growth_annual_paid',
    providerEventAt: payload.occurred_at,
    payload,
  })

  assert.equal(activated.applied, true)
  let current = (await db.query('SELECT * FROM users WHERE id = $1', [user.id])).rows[0]
  assert.equal(current.paddle_subscription_id, 'sub_new_growth_annual')
  assert.equal(current.subscription_plan, 'growth_annual')
  assert.equal(current.quota_anchor_at.toISOString(), '2026-10-15T09:00:00.000Z')

  const period = resolveResumeQuotaPeriod({
    subscriptionStatus: current.subscription_status,
    quotaAnchorAt: current.quota_anchor_at,
    referenceDate: '2026-10-20T00:00:00.000Z',
  })
  assert.equal(period.start.toISOString(), '2026-10-15T09:00:00.000Z')
  assert.equal(period.end.toISOString(), '2026-11-15T09:00:00.000Z')
  const limit = resolveMonthlyResumeAnalysisLimit('active', null, current.subscription_plan)
  let used = Number((await db.query(
    `SELECT COUNT(*)::integer AS count FROM usage_log
     WHERE user_id = $1 AND created_at >= $2 AND created_at < $3`,
    [user.id, period.start, period.end],
  )).rows[0].count)
  assert.equal(limit, 300)
  assert.equal(used, 0)
  assert.equal(limit - used, 300)

  await db.query(
    `INSERT INTO usage_log (user_id, ip_address, month_start, created_at)
     VALUES ($1, '127.0.0.1', '2026-10-15', '2026-10-16T09:00:00.000Z')`,
    [user.id],
  )
  used = Number((await db.query(
    `SELECT COUNT(*)::integer AS count FROM usage_log
     WHERE user_id = $1 AND created_at >= $2 AND created_at < $3`,
    [user.id, period.start, period.end],
  )).rows[0].count)
  assert.equal(used, 1)
  assert.equal(limit - used, 299)
  assert.equal(Number((await db.query('SELECT COUNT(*)::integer AS count FROM usage_log WHERE user_id = $1', [user.id])).rows[0].count), 8)

  const replay = await applyPaddleSubscriptionLifecycle({
    db,
    user: current,
    subscriptionId: 'sub_new_growth_annual',
    customerId: 'ctm_growth',
    environment: 'sandbox',
    eventType: 'subscription.activated',
    status: 'active',
    plan: 'growth_annual',
    priceId: 'pri_growth_annual_paid',
    providerEventAt: payload.occurred_at,
    payload,
  })
  assert.equal(replay.applied, false)
  current = (await db.query('SELECT * FROM users WHERE id = $1', [user.id])).rows[0]
  assert.equal(current.quota_anchor_at.toISOString(), '2026-10-15T09:00:00.000Z')

  const renewalPayload = structuredClone(payload)
  renewalPayload.event_id = 'evt_growth_annual_renewed'
  renewalPayload.event_type = 'subscription.updated'
  renewalPayload.occurred_at = '2027-10-15T09:00:01.000Z'
  renewalPayload.data.current_billing_period = {
    starts_at: '2027-10-15T09:00:00.000Z',
    ends_at: '2028-10-15T09:00:00.000Z',
  }
  renewalPayload.data.next_billed_at = '2028-10-15T09:00:00.000Z'
  const renewed = await applyPaddleSubscriptionLifecycle({
    db,
    user: current,
    subscriptionId: 'sub_new_growth_annual',
    customerId: 'ctm_growth',
    environment: 'sandbox',
    eventType: 'subscription.updated',
    status: 'active',
    plan: 'growth_annual',
    priceId: 'pri_growth_annual_paid',
    providerEventAt: renewalPayload.occurred_at,
    payload: renewalPayload,
  })
  assert.equal(renewed.applied, true)
  current = (await db.query('SELECT * FROM users WHERE id = $1', [user.id])).rows[0]
  assert.equal(current.quota_anchor_at.toISOString(), '2026-10-15T09:00:00.000Z')
})

test('a same-plan repurchase with a different verified subscription id also gets a fresh anchor', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const reservationToken = '6b2ca06a-da77-44fc-af0e-c9de45ab14fd'
  const user = (await db.query(
    `INSERT INTO users (
       email, paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_status, subscription_plan, trial_consumed_at, quota_anchor_at,
       cancellation_effective_at, last_paddle_event_at
     ) VALUES (
       'growth-again@example.test', 'ctm_growth_again', 'sub_old_growth', 'sandbox',
       'cancelled', 'growth_annual', '2026-01-01T00:00:00.000Z',
       '2026-09-15T09:00:00.000Z', '2026-10-15T09:00:00.000Z',
       '2026-10-15T09:00:00.000Z'
     ) RETURNING *`,
  )).rows[0]
  await db.query(
    `INSERT INTO paddle_checkout_reservations (
       reservation_token, user_id, paddle_environment, requested_plan, stored_plan,
       price_id, trial_eligible, checkout_mode, status, paddle_transaction_id, paddle_customer_id
     ) VALUES ($1::uuid, $2, 'sandbox', 'growth_annual', 'growth_annual',
               'pri_growth_annual_paid', FALSE, 'paid_returning', 'completed',
               'txn_growth_again', 'ctm_growth_again')`,
    [reservationToken, user.id],
  )
  const payload = {
    event_type: 'subscription.activated',
    occurred_at: '2026-12-15T09:00:01.000Z',
    data: {
      id: 'sub_new_growth_again',
      customer_id: 'ctm_growth_again',
      status: 'active',
      items: [{ price: { id: 'pri_growth_annual_paid' }, quantity: 1 }],
      custom_data: {
        userId: user.id,
        checkoutReservationId: reservationToken,
        requestedPlan: 'growth_annual',
        plan: 'growth_annual',
        paddleEnvironment: 'sandbox',
        checkoutMode: 'paid_returning',
        trialEligible: false,
      },
      current_billing_period: {
        starts_at: '2026-12-15T09:00:00.000Z',
        ends_at: '2027-12-15T09:00:00.000Z',
      },
      next_billed_at: '2027-12-15T09:00:00.000Z',
    },
  }
  const result = await applyPaddleSubscriptionLifecycle({
    db,
    user,
    subscriptionId: 'sub_new_growth_again',
    customerId: 'ctm_growth_again',
    environment: 'sandbox',
    eventType: 'subscription.activated',
    status: 'active',
    plan: 'growth_annual',
    priceId: 'pri_growth_annual_paid',
    providerEventAt: payload.occurred_at,
    payload,
  })

  assert.equal(result.applied, true)
  const current = (await db.query('SELECT * FROM users WHERE id = $1', [user.id])).rows[0]
  assert.equal(current.paddle_subscription_id, 'sub_new_growth_again')
  assert.equal(current.subscription_plan, 'growth_annual')
  assert.equal(current.quota_anchor_at.toISOString(), '2026-12-15T09:00:00.000Z')
})

test('checkout-first and webhook-first activation converge on the same new-lifecycle anchor', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const paddle = {
    environment: 'sandbox',
    noTrialPriceIdsByPlan: { growth_annual: 'pri_growth_annual_paid' },
  }

  async function fixture(suffix, reservationToken) {
    const user = (await db.query(
      `INSERT INTO users (
         email, paddle_customer_id, paddle_subscription_id, paddle_environment,
         subscription_status, subscription_plan, trial_consumed_at, quota_anchor_at,
         cancellation_effective_at, last_paddle_event_at
       ) VALUES ($1, $2, $3, 'sandbox', 'cancelled', 'pro_monthly',
                 '2026-01-01T00:00:00.000Z', '2026-09-15T09:00:00.000Z',
                 '2026-10-14T09:00:00.000Z', '2026-10-14T09:00:00.000Z')
       RETURNING *`,
      [`order-${suffix}@example.test`, `ctm_${suffix}`, `sub_old_${suffix}`],
    )).rows[0]
    const reservation = (await db.query(
      `INSERT INTO paddle_checkout_reservations (
         reservation_token, user_id, paddle_environment, requested_plan, stored_plan,
         price_id, trial_eligible, checkout_mode, status, paddle_transaction_id, paddle_customer_id
       ) VALUES ($1::uuid, $2, 'sandbox', 'growth_annual', 'growth_annual',
                 'pri_growth_annual_paid', FALSE, 'paid_returning', 'ready', $3, $4)
       RETURNING *`,
      [reservationToken, user.id, `txn_${suffix}`, `ctm_${suffix}`],
    )).rows[0]
    const transaction = {
      id: `txn_${suffix}`,
      status: 'completed',
      customer_id: `ctm_${suffix}`,
      subscription_id: `sub_new_${suffix}`,
      items: [{ price_id: 'pri_growth_annual_paid', quantity: 1 }],
      custom_data: {
        userId: user.id,
        checkoutReservationId: reservationToken,
        requestedPlan: 'growth_annual',
        plan: 'growth_annual',
        paddleEnvironment: 'sandbox',
        checkoutMode: 'paid_returning',
        trialEligible: false,
      },
    }
    const subscription = {
      id: `sub_new_${suffix}`,
      customer_id: `ctm_${suffix}`,
      status: 'active',
      items: [{ price: { id: 'pri_growth_annual_paid' }, quantity: 1 }],
      current_billing_period: {
        starts_at: '2026-10-15T09:00:00.000Z',
        ends_at: '2027-10-15T09:00:00.000Z',
      },
      next_billed_at: '2027-10-15T09:00:00.000Z',
      custom_data: transaction.custom_data,
    }
    const lifecyclePayload = {
      event_type: 'subscription.activated',
      occurred_at: '2026-10-15T09:00:02.000Z',
      data: subscription,
    }
    return { user, reservation, transaction, subscription, lifecyclePayload }
  }

  async function finalizeCheckout(input, user) {
    const client = await db.connect()
    try {
      const result = await persistVerifiedCheckoutSubscription({
        client,
        user,
        transaction: input.transaction,
        subscription: input.subscription,
        paddle,
        reservation: input.reservation,
        now: new Date('2026-10-16T00:00:00.000Z'),
      })
      assert.equal(result.synced, true)
    } finally {
      client.release()
    }
  }

  async function applyWebhook(input, user) {
    const result = await applyPaddleSubscriptionLifecycle({
      db,
      user,
      subscriptionId: input.subscription.id,
      customerId: input.subscription.customer_id,
      environment: 'sandbox',
      eventType: 'subscription.activated',
      status: 'active',
      plan: 'growth_annual',
      priceId: 'pri_growth_annual_paid',
      providerEventAt: input.lifecyclePayload.occurred_at,
      payload: input.lifecyclePayload,
    })
    assert.equal(result.applied, true)
  }

  const checkoutFirst = await fixture('checkout_first', '42d85541-3b0e-4b1a-8dca-2525950fbaf0')
  await finalizeCheckout(checkoutFirst, checkoutFirst.user)
  let checkoutFirstUser = (await db.query('SELECT * FROM users WHERE id = $1', [checkoutFirst.user.id])).rows[0]
  await applyWebhook(checkoutFirst, checkoutFirstUser)
  checkoutFirstUser = (await db.query('SELECT * FROM users WHERE id = $1', [checkoutFirst.user.id])).rows[0]

  const webhookFirst = await fixture('webhook_first', '6b2ca06a-da77-44fc-af0e-c9de45ab14fd')
  await applyWebhook(webhookFirst, webhookFirst.user)
  let webhookFirstUser = (await db.query('SELECT * FROM users WHERE id = $1', [webhookFirst.user.id])).rows[0]
  await finalizeCheckout(webhookFirst, webhookFirstUser)
  webhookFirstUser = (await db.query('SELECT * FROM users WHERE id = $1', [webhookFirst.user.id])).rows[0]

  assert.equal(checkoutFirstUser.quota_anchor_at.toISOString(), '2026-10-15T09:00:00.000Z')
  assert.equal(webhookFirstUser.quota_anchor_at.toISOString(), '2026-10-15T09:00:00.000Z')
})

test('PostgreSQL lifecycle projection is ordered, ownership-safe, and atomic', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const inserted = await db.query(
    `INSERT INTO users (
       email, paddle_customer_id, paddle_subscription_id, paddle_environment,
       subscription_status, subscription_plan, quota_anchor_at, last_paddle_event_at
     ) VALUES (
       'lifecycle@example.test', 'ctm_lifecycle', 'sub_lifecycle', 'sandbox',
       'active', 'monthly', '2026-08-01T00:00:00.000Z', '2026-08-02T10:00:00.000Z'
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
  assert.equal(current.user.quota_anchor_at.toISOString(), '2026-08-01T00:00:00.000Z')
  assert.equal(canUsePaidMutation(current.user), true)

  const kept = await apply(db, current.user, {
    eventType: 'subscription.updated', status: 'active', storedStatus: 'active',
    occurredAt: '2026-08-02T10:03:00.000Z',
  })
  assert.equal(kept.applied, true)
  current = await state(db, user.id)
  assert.equal(current.user.cancellation_effective_at, null)
  assert.equal(current.user.quota_anchor_at.toISOString(), '2026-08-01T00:00:00.000Z')

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
