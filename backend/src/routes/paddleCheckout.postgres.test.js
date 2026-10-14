import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { pool as appPool } from '../db/client.js'
import { up as protectCheckoutOwnership } from '../db/migrations/053-protect-paddle-checkout-ownership.js'
import { markCheckoutReservationCompleted } from '../services/paddleCheckoutReservations.js'
import {
  acquireCheckoutReservation,
  createCheckout,
  storeCheckoutReservationResult,
} from './paddleCheckout.js'

const connectionString = process.env.CHECKOUT_POSTGRES_TEST_DATABASE_URL

function paddle() {
  return {
    environment: 'sandbox',
    priceIdsByPlan: { monthly: 'pri_monthly', annual: 'pri_annual' },
    noTrialPriceIdsByPlan: { monthly: 'pri_monthly_paid', annual: 'pri_annual_paid' },
    testCheckout: { enabled: false },
  }
}

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

async function createDatabase() {
  const db = new pg.Pool({ connectionString, max: 20 })
  await db.query('DROP TABLE IF EXISTS paddle_checkout_reservations, subscriptions, payment_attempts, users CASCADE')
  await db.query(`
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      paddle_customer_id TEXT,
      paddle_subscription_id TEXT,
      paddle_environment TEXT DEFAULT 'production',
      subscription_status TEXT DEFAULT 'inactive',
      subscription_started_at TIMESTAMP,
      trial_ends_at TIMESTAMP,
      trial_consumed_at TIMESTAMP,
      subscription_plan TEXT,
      current_period_end TIMESTAMP,
      subscription_renewal_date TIMESTAMP,
      next_billing_date TIMESTAMP,
      cancellation_effective_at TIMESTAMP,
      cancellation_reason TEXT,
      last_paddle_event_at TIMESTAMPTZ,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE TABLE payment_attempts (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id),
    next_retry_at TIMESTAMP, metadata JSONB, payload JSONB,
    paddle_environment TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT, updated_at TIMESTAMP DEFAULT NOW()
  )`)
  await db.query(`
    CREATE TABLE subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT REFERENCES users(id),
      paddle_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'inactive',
      latest_event_type TEXT,
      latest_event_payload JSONB,
      paddle_environment TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await protectCheckoutOwnership(db)
  return db
}

test('PostgreSQL serializes concurrent checkout reservations and enforces provider ownership', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())

  const userResult = await db.query(
    `INSERT INTO users (email, paddle_environment) VALUES ('concurrent@example.test', 'sandbox') RETURNING id`,
  )
  const userId = userResult.rows[0].id
  const requests = Array.from({ length: 12 }, () => acquireCheckoutReservation({
    db,
    userId,
    paddle: paddle(),
    plan: 'monthly',
  }))
  const results = await Promise.all(requests)

  assert.equal(results.filter((result) => result.action === 'create').length, 1)
  assert.equal(results.filter((result) => result.action === 'in_progress').length, 11)
  assert.equal(new Set(results.map((result) => result.reservation.id)).size, 1)
  assert.equal((await db.query(`SELECT COUNT(*)::integer AS count FROM paddle_checkout_reservations WHERE status = 'creating'`)).rows[0].count, 1)

  const created = results.find((result) => result.action === 'create')
  await storeCheckoutReservationResult({
    db,
    reservation: created.reservation,
    transaction: {
      id: 'txn_concurrent_123',
      status: 'ready',
      customer_id: 'ctm_concurrent_123',
      checkout: { url: 'https://checkout.paddle.test/pay?_ptxn=txn_concurrent_123' },
    },
  })

  const retries = await Promise.all(Array.from({ length: 8 }, () => acquireCheckoutReservation({
    db,
    userId,
    paddle: paddle(),
    plan: 'monthly',
  })))
  assert.equal(retries.every((result) => result.action === 'reuse'), true)
  assert.equal(new Set(retries.map((result) => result.reservation.paddle_transaction_id)).size, 1)

  const annual = await acquireCheckoutReservation({ db, userId, paddle: paddle(), plan: 'annual' })
  assert.equal(annual.action, 'purchase_conflict')

  const otherUser = await db.query(
    `INSERT INTO users (email, paddle_environment) VALUES ('other@example.test', 'sandbox') RETURNING id`,
  )
  await db.query(`UPDATE users SET paddle_customer_id = 'ctm_owned' WHERE id = $1`, [userId])
  await assert.rejects(
    db.query(`UPDATE users SET paddle_customer_id = 'ctm_owned' WHERE id = $1`, [otherUser.rows[0].id]),
    (error) => error.code === '23505',
  )

  const productionUser = await db.query(
    `INSERT INTO users (email, paddle_environment, paddle_customer_id)
     VALUES ('production@example.test', 'production', 'ctm_owned') RETURNING id`,
  )
  assert.ok(productionUser.rows[0].id)

  await db.query(`UPDATE users SET paddle_subscription_id = 'sub_owned' WHERE id = $1`, [userId])
  await assert.rejects(
    db.query(`UPDATE users SET paddle_subscription_id = 'sub_owned' WHERE id = $1`, [otherUser.rows[0].id]),
    (error) => error.code === '23505',
  )
  await db.query(`UPDATE users SET paddle_subscription_id = 'sub_owned' WHERE id = $1`, [productionUser.rows[0].id])

  await db.query(
    `INSERT INTO subscriptions (user_id, paddle_subscription_id, status, paddle_environment)
     VALUES ($1, 'sub_shared_text', 'active', 'sandbox')`,
    [userId],
  )
  await db.query(
    `INSERT INTO subscriptions (user_id, paddle_subscription_id, status, paddle_environment)
     VALUES ($1, 'sub_shared_text', 'active', 'production')`,
    [productionUser.rows[0].id],
  )
  assert.equal(
    (await db.query(`SELECT COUNT(*)::integer AS count FROM subscriptions WHERE paddle_subscription_id = 'sub_shared_text'`)).rows[0].count,
    2,
  )
})

test('PostgreSQL preserves one no-trial resubscription reservation for a cancelled account', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const userResult = await db.query(
    `INSERT INTO users (
       email, paddle_environment, paddle_customer_id, paddle_subscription_id,
       subscription_status, trial_consumed_at, cancellation_effective_at
     ) VALUES (
       'returning@example.test', 'sandbox', 'ctm_returning', 'sub_cancelled',
       'cancelled', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'
     ) RETURNING id`,
  )

  const results = await Promise.all(Array.from({ length: 6 }, () => acquireCheckoutReservation({
    db,
    userId: userResult.rows[0].id,
    paddle: paddle(),
    plan: 'annual',
  })))

  assert.equal(results.filter((result) => result.action === 'create').length, 1)
  assert.equal(results.every((result) => result.purchase.trialEligible === false), true)
  assert.equal(results.every((result) => result.purchase.priceId === 'pri_annual_paid'), true)
})

test('a completed returning checkout blocks duplicate Paddle creation until applied, then permits a later purchase', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  const userId = (await db.query(
    `INSERT INTO users (email, paddle_environment, paddle_customer_id, subscription_status,
                        trial_consumed_at, cancellation_effective_at)
     VALUES ('completed@example.test', 'sandbox', 'ctm_completed_pg', 'cancelled',
             NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day') RETURNING id`,
  )).rows[0].id
  const originalEnvironment = {
    PADDLE_ENVIRONMENT: process.env.PADDLE_ENVIRONMENT,
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
    PADDLE_SANDBOX_CLIENT_TOKEN: process.env.PADDLE_SANDBOX_CLIENT_TOKEN,
    PADDLE_SANDBOX_MONTHLY_NO_TRIAL_PRICE_ID: process.env.PADDLE_SANDBOX_MONTHLY_NO_TRIAL_PRICE_ID,
    APP_ORIGIN: process.env.APP_ORIGIN,
  }
  Object.assign(process.env, {
    PADDLE_ENVIRONMENT: 'sandbox', PADDLE_SANDBOX_API_KEY: 'sandbox-api-key',
    PADDLE_SANDBOX_CLIENT_TOKEN: 'sandbox-client-token',
    PADDLE_SANDBOX_MONTHLY_NO_TRIAL_PRICE_ID: 'pri_monthly_paid',
    APP_ORIGIN: 'https://hireflow.example.test',
  })
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const transactions = new Map()
  let createCalls = 0
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST' && String(url).endsWith('/transactions')) {
      const body = JSON.parse(options.body)
      createCalls += 1
      const transaction = {
        id: `txn_completed_pg${createCalls}`, status: 'ready', subscription_id: null,
        customer_id: 'ctm_completed_pg', items: body.items, custom_data: body.custom_data,
        checkout: { url: `https://checkout.paddle.test/pay?_ptxn=txn_completed_pg${createCalls}` },
      }
      transactions.set(transaction.id, transaction)
      return { ok: true, status: 200, json: async () => ({ data: transaction }) }
    }
    const transaction = transactions.get(String(url).split('/transactions/')[1])
    if (transaction) return { ok: true, status: 200, json: async () => ({ data: transaction }) }
    if (String(url).includes('/subscriptions/sub_new_pg')) {
      return { ok: true, status: 200, json: async () => ({ data: {
        id: 'sub_new_pg', status: 'canceled', customer_id: 'ctm_completed_pg',
        updated_at: new Date().toISOString(), canceled_at: new Date(Date.now() - 1000).toISOString(),
        current_billing_period: { ends_at: new Date(Date.now() - 1000).toISOString() },
        next_billed_at: null, items: [{ price: { id: 'pri_monthly_paid' } }],
      } }) }
    }
    throw new Error(`Unexpected Paddle request: ${url}`)
  })

  const request = { body: { plan: 'monthly' }, userId, protocol: 'https', get: () => 'hireflow.example.test' }
  const first = responseRecorder()
  await createCheckout(request, first, 'postgres-completed')
  assert.equal(first.statusCode, 200)
  assert.equal(first.payload.checkoutMode, 'paid_returning')
  assert.equal(first.payload.trialEligible, false)
  assert.equal(createCalls, 1)

  const reservation = (await db.query('SELECT * FROM paddle_checkout_reservations WHERE user_id = $1', [userId])).rows[0]
  const paid = transactions.get(first.payload.transactionId)
  paid.status = 'completed'
  paid.subscription_id = 'sub_new_pg'
  await markCheckoutReservationCompleted({
    db, reservationToken: reservation.reservation_token, userId, environment: 'sandbox',
    transactionId: paid.id, customerId: paid.customer_id,
  })

  for (let retry = 0; retry < 2; retry += 1) {
    const response = responseRecorder()
    await createCheckout(request, response, 'postgres-completed-retry')
    assert.equal(response.statusCode, 409)
    assert.deepEqual(response.payload, {
      error: 'This checkout has already completed. Subscription confirmation is in progress.',
      code: 'checkout_completed', redirectTo: '/billing/success',
      transactionId: paid.id, checkoutReservationId: reservation.reservation_token,
      plan: 'monthly',
    })
  }
  assert.equal(createCalls, 1)

  // That purchased lifecycle was applied and later cancelled; the old receipt
  // must not block an entirely new no-trial purchase.
  await db.query(
    `UPDATE users SET paddle_subscription_id = 'sub_new_pg', subscription_plan = 'monthly',
                      cancellation_effective_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
    [userId],
  )
  const later = responseRecorder()
  await createCheckout(request, later, 'postgres-new-purchase')
  assert.equal(later.statusCode, 200)
  assert.equal(later.payload.checkoutMode, 'paid_returning')
  assert.equal(later.payload.trialEligible, false)
  assert.notEqual(later.payload.transactionId, paid.id)
  assert.equal(createCalls, 2)
})

test('concurrent checkout runtime requests make one Paddle create call and reuse its transaction', {
  skip: !connectionString,
}, async (t) => {
  const db = await createDatabase()
  t.after(async () => db.end())
  t.after(async () => appPool.end())
  const userResult = await db.query(
    `INSERT INTO users (email, paddle_environment) VALUES ('runtime@example.test', 'sandbox') RETURNING id`,
  )
  const userId = userResult.rows[0].id
  const originalEnvironment = {
    PADDLE_ENVIRONMENT: process.env.PADDLE_ENVIRONMENT,
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
    PADDLE_SANDBOX_CLIENT_TOKEN: process.env.PADDLE_SANDBOX_CLIENT_TOKEN,
    PADDLE_SANDBOX_MONTHLY_PRICE_ID: process.env.PADDLE_SANDBOX_MONTHLY_PRICE_ID,
    APP_ORIGIN: process.env.APP_ORIGIN,
  }
  Object.assign(process.env, {
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_SANDBOX_API_KEY: 'sandbox-api-key',
    PADDLE_SANDBOX_CLIENT_TOKEN: 'sandbox-client-token',
    PADDLE_SANDBOX_MONTHLY_PRICE_ID: 'pri_monthly',
    APP_ORIGIN: 'https://hireflow.example.test',
  })
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  let createCalls = 0
  let createdTransaction = null
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST' && String(url).endsWith('/transactions')) {
      createCalls += 1
      const requestBody = JSON.parse(options.body)
      await new Promise((resolve) => setTimeout(resolve, 50))
      createdTransaction = {
        id: 'txn_runtime123',
        status: 'ready',
        customer_id: 'ctm_runtime123',
        subscription_id: null,
        items: requestBody.items,
        custom_data: requestBody.custom_data,
        checkout: { url: 'https://checkout.paddle.test/pay?_ptxn=txn_runtime123' },
      }
      return { ok: true, status: 200, json: async () => ({ data: createdTransaction }) }
    }
    if (String(url).endsWith('/transactions/txn_runtime123')) {
      return { ok: true, status: 200, json: async () => ({ data: createdTransaction }) }
    }
    throw new Error(`Unexpected Paddle request: ${url}`)
  })

  const request = {
    body: { plan: 'monthly' },
    userId,
    protocol: 'https',
    get: () => 'hireflow.example.test',
  }
  const responses = Array.from({ length: 12 }, responseRecorder)
  await Promise.all(responses.map((response) => createCheckout(request, response, 'postgres-test')))

  const successfulResponses = responses.filter((response) => response.statusCode === 200)
  const inProgressResponses = responses.filter(
    (response) => response.statusCode === 409 && response.payload.code === 'checkout_in_progress',
  )

  assert.equal(createCalls, 1)
  assert.equal(successfulResponses.length >= 1, true)
  assert.equal(
    successfulResponses.every((response) => response.payload.transactionId === 'txn_runtime123'),
    true,
  )
  assert.equal(successfulResponses.length + inProgressResponses.length, responses.length)

  const retry = responseRecorder()
  await createCheckout(request, retry, 'postgres-test-retry')
  assert.equal(retry.statusCode, 200)
  assert.equal(retry.payload.transactionId, 'txn_runtime123')
  assert.equal(createCalls, 1)
})
