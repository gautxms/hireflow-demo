import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  REQUIRED_PADDLE_WEBHOOK_INBOX_COLUMNS,
  REQUIRED_PADDLE_WEBHOOK_INBOX_INDEXES,
  assertPaddleBillingPrerequisites,
  checkPaddleBillingReadiness,
  getConfiguredPaddleEnvironments,
  inspectPaddleBillingConfiguration,
  setPaddleWebhookWorkerState,
  verifyPaddleWebhookInboxSchema,
} from './paddleBillingReadiness.js'

const mandatoryFlags = {
  PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED: 'true',
  PADDLE_WEBHOOK_RETRY_WORKER_ENABLED: 'true',
}

function readySchemaRow(overrides = {}) {
  return {
    table_exists: true,
    column_names: [...REQUIRED_PADDLE_WEBHOOK_INBOX_COLUMNS],
    index_names: [...REQUIRED_PADDLE_WEBHOOK_INBOX_INDEXES],
    ...overrides,
  }
}

function readyDb(overrides = {}) {
  return {
    async query() {
      return { rows: [readySchemaRow(overrides)] }
    },
  }
}

test('backend startup awaits billing prerequisites and worker readiness before listening', () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const prerequisiteGate = source.indexOf('await assertPaddleBillingPrerequisites')
  const workerGate = source.indexOf('await startPaddleWebhookRetryWorker')
  const listener = source.indexOf('app.listen')
  assert.ok(prerequisiteGate >= 0)
  assert.ok(workerGate > prerequisiteGate)
  assert.ok(listener > workerGate)
})

test('local runtime without Paddle configuration does not require billing infrastructure', async () => {
  const configuration = inspectPaddleBillingConfiguration({ NODE_ENV: 'development' })
  assert.equal(configuration.paddleEnabled, false)
  assert.equal(configuration.ready, true)

  const readiness = await checkPaddleBillingReadiness({ env: {}, db: null })
  assert.equal(readiness.enabled, false)
  assert.equal(readiness.ready, true)
  assert.equal(readiness.worker.required, false)
})

test('Sandbox and Production configurations are detected independently', () => {
  assert.deepEqual(getConfiguredPaddleEnvironments({
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_SANDBOX_API_KEY: 'sandbox-key',
  }), ['sandbox'])
  assert.deepEqual(getConfiguredPaddleEnvironments({
    PADDLE_API_KEY: 'production-key',
    PADDLE_SANDBOX_API_KEY: 'sandbox-key',
  }), ['production', 'sandbox'])
})

for (const [environment, environmentConfig] of [
  ['sandbox', {
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_SANDBOX_API_KEY: 'sandbox-key',
    PADDLE_SANDBOX_WEBHOOK_SECRET: 'sandbox-secret',
  }],
  ['production', {
    PADDLE_ENVIRONMENT: 'production',
    PADDLE_PRODUCTION_API_KEY: 'production-key',
    PADDLE_PRODUCTION_WEBHOOK_SECRET: 'production-secret',
  }],
]) {
  test(`${environment} Paddle configuration is ready only with durable inbox and worker flags`, () => {
    const result = inspectPaddleBillingConfiguration({ ...environmentConfig, ...mandatoryFlags })
    assert.equal(result.paddleEnabled, true)
    assert.equal(result.ready, true)
    assert.deepEqual(result.environments, [environment])
  })
}

test('Paddle-enabled configuration fails closed when durable processing is missing or disabled', () => {
  const base = {
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_SANDBOX_API_KEY: 'sandbox-key',
    PADDLE_SANDBOX_WEBHOOK_SECRET: 'sandbox-secret',
  }
  const absent = inspectPaddleBillingConfiguration(base)
  assert.deepEqual(absent.errors.map((error) => error.code), [
    'DURABLE_WEBHOOK_INBOX_DISABLED',
    'PADDLE_WEBHOOK_RETRY_WORKER_DISABLED',
  ])

  const explicitlyDisabled = inspectPaddleBillingConfiguration({
    ...base,
    PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED: 'false',
    PADDLE_WEBHOOK_RETRY_WORKER_ENABLED: 'false',
  })
  assert.equal(explicitlyDisabled.ready, false)
})

test('environment-specific webhook secret cannot be substituted by the other environment secret', () => {
  const result = inspectPaddleBillingConfiguration({
    ...mandatoryFlags,
    PADDLE_SANDBOX_API_KEY: 'sandbox-key',
    PADDLE_PRODUCTION_WEBHOOK_SECRET: 'production-secret',
  })
  assert.equal(result.ready, false)
  assert.deepEqual(result.environments, ['production', 'sandbox'])
  assert.ok(result.errors.some((error) => (
    error.code === 'PADDLE_WEBHOOK_SECRET_MISSING' && error.environment === 'sandbox'
  )))
  assert.equal(JSON.stringify(result).includes('production-secret'), false)
})

test('durable inbox schema readiness verifies required table, columns, and indexes', async () => {
  assert.equal((await verifyPaddleWebhookInboxSchema(readyDb())).ready, true)

  const missingTable = await verifyPaddleWebhookInboxSchema(readyDb({
    table_exists: false,
    column_names: [],
    index_names: [],
  }))
  assert.equal(missingTable.ready, false)
  assert.equal(missingTable.errors[0].code, 'PADDLE_WEBHOOK_INBOX_TABLE_MISSING')

  const missingSchema = await verifyPaddleWebhookInboxSchema(readyDb({
    column_names: REQUIRED_PADDLE_WEBHOOK_INBOX_COLUMNS.filter((column) => column !== 'verified_at'),
    index_names: REQUIRED_PADDLE_WEBHOOK_INBOX_INDEXES.filter((index) => index !== 'idx_paddle_webhook_events_scheduled_retry'),
  }))
  assert.equal(missingSchema.ready, false)
  assert.deepEqual(missingSchema.missingColumns, ['verified_at'])
  assert.deepEqual(missingSchema.missingIndexes, ['idx_paddle_webhook_events_scheduled_retry'])
})

test('schema query failure is sanitized and prevents billing readiness', async () => {
  const schema = await verifyPaddleWebhookInboxSchema({
    async query() {
      throw new Error('postgresql://user:secret@example.test/private')
    },
  })
  assert.equal(schema.ready, false)
  assert.equal(schema.errors[0].code, 'PADDLE_WEBHOOK_INBOX_SCHEMA_CHECK_FAILED')
  assert.equal(JSON.stringify(schema).includes('secret'), false)
})

test('startup prerequisites fail before billing traffic when required schema is missing', async () => {
  await assert.rejects(
    assertPaddleBillingPrerequisites({
      env: {
        ...mandatoryFlags,
        PADDLE_ENVIRONMENT: 'sandbox',
        PADDLE_SANDBOX_API_KEY: 'sandbox-key',
        PADDLE_SANDBOX_WEBHOOK_SECRET: 'sandbox-secret',
      },
      db: readyDb({ table_exists: false, column_names: [], index_names: [] }),
    }),
    (error) => {
      assert.equal(error.code, 'PADDLE_BILLING_NOT_READY')
      assert.match(error.message, /PADDLE_WEBHOOK_INBOX_TABLE_MISSING/)
      return true
    },
  )
})

test('runtime readiness reports worker failure without exposing internal error details', async () => {
  const env = {
    ...mandatoryFlags,
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_SANDBOX_API_KEY: 'sandbox-key',
    PADDLE_SANDBOX_WEBHOOK_SECRET: 'sandbox-secret',
  }
  setPaddleWebhookWorkerState({ ready: false, status: 'failed', errorCode: 'ECONNREFUSED' })
  const failed = await checkPaddleBillingReadiness({ env, db: readyDb() })
  assert.equal(failed.ready, false)
  assert.equal(failed.worker.status, 'failed')
  assert.ok(failed.errors.some((error) => error.code === 'PADDLE_WEBHOOK_RETRY_WORKER_NOT_READY'))
  assert.equal(JSON.stringify(failed).includes('ECONNREFUSED'), false)

  setPaddleWebhookWorkerState({ ready: true, status: 'running' })
  const ready = await checkPaddleBillingReadiness({ env, db: readyDb() })
  assert.equal(ready.ready, true)
  assert.equal(ready.worker.ready, true)
})
