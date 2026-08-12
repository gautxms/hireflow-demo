import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { up as addDurablePaddleWebhookInbox } from '../db/migrations/050-add-durable-paddle-webhook-inbox.js'
import { up as addPaddleWebhookRetryScheduling } from '../db/migrations/051-add-paddle-webhook-retry-scheduling.js'
import { up as backfillPaddleWebhookVerificationGap } from '../db/migrations/052-backfill-paddle-webhook-verification-gap.js'
import {
  assertPaddleBillingPrerequisites,
  verifyPaddleWebhookInboxSchema,
} from './paddleBillingReadiness.js'
import {
  buildUtcPostgresOptions,
  verifyUtcTimestampContract,
} from '../db/utcTimestampContract.js'
import { normalizePaddleTimestamp } from '../utils/paddleTimestamps.js'
import { resolveResumeQuotaPeriod } from '../utils/resumeQuotaPeriod.js'

const connectionString = process.env.BILLING_READINESS_POSTGRES_TEST_DATABASE_URL

test('PostgreSQL billing readiness fails without the inbox schema and passes after migrations 050-052', {
  skip: !connectionString,
}, async (t) => {
  const db = new pg.Pool({
    connectionString,
    max: 2,
    options: buildUtcPostgresOptions(),
  })
  t.after(async () => db.end())
  await db.query('DROP TABLE IF EXISTS paddle_webhook_events CASCADE')

  const utcContract = await verifyUtcTimestampContract(db)
  assert.equal(utcContract.ready, true, JSON.stringify(utcContract))

  const nonUtcClient = new pg.Client({ connectionString })
  await nonUtcClient.connect()
  await nonUtcClient.query("SET TIME ZONE 'Asia/Kolkata'")
  const nonUtcContract = await verifyUtcTimestampContract(nonUtcClient)
  assert.equal(nonUtcContract.ready, false)
  assert.ok(nonUtcContract.errors.some((error) => error.code === 'PADDLE_DATABASE_TIMEZONE_NOT_UTC'))
  await nonUtcClient.end()

  const client = await db.connect()
  try {
    await client.query(`
      CREATE TEMP TABLE paddle_utc_contract_dates (
        cancellation_effective_at TIMESTAMP,
        monthly_quota_anchor_at TIMESTAMP,
        annual_quota_anchor_at TIMESTAMP,
        bound_date_expires_at TIMESTAMP
      )
    `)
    const normalizedInstant = normalizePaddleTimestamp('2026-02-01T05:00:00+05:30')
    const originalTimezone = process.env.TZ
    try {
      process.env.TZ = 'America/New_York'
      const boundDate = new Date('2026-01-31T23:30:00.000Z')
      await client.query(
        `INSERT INTO paddle_utc_contract_dates (
           cancellation_effective_at, monthly_quota_anchor_at, annual_quota_anchor_at,
           bound_date_expires_at
         ) VALUES ($1::timestamp, $2::timestamp, $3::timestamp, $4)`,
        [normalizedInstant, normalizedInstant, normalizedInstant, boundDate],
      )
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
    const row = (await client.query(`
      SELECT *,
             cancellation_effective_at > '2026-01-31T23:29:59.999Z'::timestamptz AS active_before_boundary,
             cancellation_effective_at <= '2026-01-31T23:30:00.000Z'::timestamptz AS ended_at_boundary
      FROM paddle_utc_contract_dates
    `)).rows[0]

    assert.equal(row.cancellation_effective_at.toISOString(), '2026-01-31T23:30:00.000Z')
    assert.equal(row.bound_date_expires_at.toISOString(), '2026-01-31T23:30:00.000Z')
    assert.equal(row.active_before_boundary, true)
    assert.equal(row.ended_at_boundary, true)

    const monthlyPeriod = resolveResumeQuotaPeriod({
      subscriptionStatus: 'active',
      quotaAnchorAt: row.monthly_quota_anchor_at,
      referenceDate: '2026-02-28T23:30:00.000Z',
    })
    assert.equal(monthlyPeriod.start.toISOString(), '2026-02-28T23:30:00.000Z')
    assert.equal(monthlyPeriod.end.toISOString(), '2026-03-31T23:30:00.000Z')

    const annualSubscriberMonthlyPeriod = resolveResumeQuotaPeriod({
      subscriptionStatus: 'active',
      quotaAnchorAt: row.annual_quota_anchor_at,
      referenceDate: '2026-07-31T23:30:00.000Z',
    })
    assert.equal(annualSubscriberMonthlyPeriod.start.toISOString(), '2026-07-31T23:30:00.000Z')
    assert.equal(annualSubscriberMonthlyPeriod.end.toISOString(), '2026-08-31T23:30:00.000Z')
  } finally {
    client.release()
  }

  const missing = await verifyPaddleWebhookInboxSchema(db)
  assert.equal(missing.ready, false)
  assert.equal(missing.errors[0].code, 'PADDLE_WEBHOOK_INBOX_TABLE_MISSING')

  await addDurablePaddleWebhookInbox(db)
  await addPaddleWebhookRetryScheduling(db)
  await backfillPaddleWebhookVerificationGap(db)

  const migrated = await verifyPaddleWebhookInboxSchema(db)
  assert.equal(migrated.ready, true, JSON.stringify(migrated))
  assert.deepEqual(migrated.missingColumns, [])
  assert.deepEqual(migrated.missingIndexes, [])

  const readiness = await assertPaddleBillingPrerequisites({
    env: {
      PADDLE_ENVIRONMENT: 'sandbox',
      PADDLE_SANDBOX_API_KEY: 'sandbox-key',
      PADDLE_SANDBOX_WEBHOOK_SECRET: 'sandbox-secret',
      PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED: 'true',
      PADDLE_WEBHOOK_RETRY_WORKER_ENABLED: 'true',
    },
    db,
  })
  assert.equal(readiness.ready, true)
  assert.equal(readiness.utcTimestampContract.ready, true)

  await db.query('DROP INDEX idx_paddle_webhook_events_scheduled_retry')
  const missingIndex = await verifyPaddleWebhookInboxSchema(db)
  assert.equal(missingIndex.ready, false)
  assert.deepEqual(missingIndex.missingIndexes, ['idx_paddle_webhook_events_scheduled_retry'])
})
