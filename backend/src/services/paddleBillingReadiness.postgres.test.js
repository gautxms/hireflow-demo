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

const connectionString = process.env.BILLING_READINESS_POSTGRES_TEST_DATABASE_URL

test('PostgreSQL billing readiness fails without the inbox schema and passes after migrations 050-052', {
  skip: !connectionString,
}, async (t) => {
  const db = new pg.Pool({ connectionString, max: 2 })
  t.after(async () => db.end())
  await db.query('DROP TABLE IF EXISTS paddle_webhook_events CASCADE')

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

  await db.query('DROP INDEX idx_paddle_webhook_events_scheduled_retry')
  const missingIndex = await verifyPaddleWebhookInboxSchema(db)
  assert.equal(missingIndex.ready, false)
  assert.deepEqual(missingIndex.missingIndexes, ['idx_paddle_webhook_events_scheduled_retry'])
})
