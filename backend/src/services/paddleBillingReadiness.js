import { normalizePaddleEnvironment, resolvePaddleConfig } from '../config/paddle.js'

const DURABLE_WEBHOOK_INBOX_FLAG = 'PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED'
const RETRY_WORKER_FLAG = 'PADDLE_WEBHOOK_RETRY_WORKER_ENABLED'

const PADDLE_CONFIGURATION_SIGNALS = {
  production: [
    'PADDLE_PRODUCTION_API_KEY',
    'PADDLE_PRODUCTION_CLIENT_TOKEN',
    'PADDLE_PRODUCTION_WEBHOOK_SECRET',
    'PADDLE_PRODUCTION_MONTHLY_PRICE_ID',
    'PADDLE_PRODUCTION_ANNUAL_PRICE_ID',
    'PADDLE_PRODUCTION_MONTHLY_NO_TRIAL_PRICE_ID',
    'PADDLE_PRODUCTION_ANNUAL_NO_TRIAL_PRICE_ID',
    'PADDLE_API_KEY',
    'PADDLE_CLIENT_TOKEN',
    'PADDLE_WEBHOOK_SECRET',
    'PADDLE_MONTHLY_PRICE_ID',
    'PADDLE_ANNUAL_PRICE_ID',
    'PADDLE_MONTHLY_NO_TRIAL_PRICE_ID',
    'PADDLE_ANNUAL_NO_TRIAL_PRICE_ID',
  ],
  sandbox: [
    'PADDLE_SANDBOX_API_KEY',
    'PADDLE_SANDBOX_CLIENT_TOKEN',
    'PADDLE_SANDBOX_WEBHOOK_SECRET',
    'PADDLE_SANDBOX_MONTHLY_PRICE_ID',
    'PADDLE_SANDBOX_ANNUAL_PRICE_ID',
    'PADDLE_SANDBOX_MONTHLY_NO_TRIAL_PRICE_ID',
    'PADDLE_SANDBOX_ANNUAL_NO_TRIAL_PRICE_ID',
  ],
}

export const REQUIRED_PADDLE_WEBHOOK_INBOX_COLUMNS = [
  'event_id',
  'event_type',
  'payload_hash',
  'payload',
  'paddle_environment',
  'status',
  'attempt_count',
  'scheduler_attempt_count',
  'first_received_at',
  'last_attempt_at',
  'processed_at',
  'completed_at',
  'failed_at',
  'next_retry_at',
  'processing_token',
  'verified_at',
  'last_error_code',
  'last_error_message',
]

export const REQUIRED_PADDLE_WEBHOOK_INBOX_INDEXES = [
  'paddle_webhook_events_event_id_key',
  'idx_paddle_webhook_events_retryable',
  'idx_paddle_webhook_events_scheduled_retry',
]

let workerState = {
  ready: false,
  status: 'not_started',
  errorCode: null,
  checkedAt: null,
}

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true'
}

function configured(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function isDurableWebhookInboxEnabled(env = process.env) {
  return enabled(env?.[DURABLE_WEBHOOK_INBOX_FLAG])
}

export function getConfiguredPaddleEnvironments(env = process.env) {
  const signalEnvironments = Object.entries(PADDLE_CONFIGURATION_SIGNALS)
    .filter(([, keys]) => keys.some((key) => configured(env?.[key])))
    .map(([environment]) => environment)
  if (signalEnvironments.length === 0) return []

  const defaultEnvironment = normalizePaddleEnvironment(env?.PADDLE_ENVIRONMENT)
  return ['production', 'sandbox'].filter((environment) => (
    environment === defaultEnvironment || signalEnvironments.includes(environment)
  ))
}

export function inspectPaddleBillingConfiguration(env = process.env) {
  const environments = getConfiguredPaddleEnvironments(env)
  const paddleEnabled = environments.length > 0
  const durableInboxEnabled = isDurableWebhookInboxEnabled(env)
  const retryWorkerEnabled = enabled(env?.[RETRY_WORKER_FLAG])
  const errors = []

  if (paddleEnabled && !durableInboxEnabled) {
    errors.push({
      code: 'DURABLE_WEBHOOK_INBOX_DISABLED',
      message: `${DURABLE_WEBHOOK_INBOX_FLAG} must be true when Paddle billing is configured.`,
    })
  }

  if (paddleEnabled && !retryWorkerEnabled) {
    errors.push({
      code: 'PADDLE_WEBHOOK_RETRY_WORKER_DISABLED',
      message: `${RETRY_WORKER_FLAG} must be true when Paddle billing is configured.`,
    })
  }

  for (const environment of environments) {
    const config = resolvePaddleConfig(env, environment)
    if (!config.webhookSecret) {
      errors.push({
        code: 'PADDLE_WEBHOOK_SECRET_MISSING',
        environment,
        message: `The ${environment} Paddle webhook secret is required for billing readiness.`,
      })
    }
  }

  return {
    paddleEnabled,
    environments,
    durableInboxEnabled,
    retryWorkerEnabled,
    ready: errors.length === 0,
    errors,
  }
}

export async function verifyPaddleWebhookInboxSchema(db) {
  try {
    const result = await db.query(`
      SELECT
        to_regclass('public.paddle_webhook_events') IS NOT NULL AS table_exists,
        COALESCE((
          SELECT ARRAY_AGG(column_name ORDER BY column_name)
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'paddle_webhook_events'
        ), ARRAY[]::text[]) AS column_names,
        COALESCE((
          SELECT ARRAY_AGG(indexname ORDER BY indexname)
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'paddle_webhook_events'
        ), ARRAY[]::text[]) AS index_names
    `)
    const row = result.rows[0] || {}
    const columns = new Set(row.column_names || [])
    const indexes = new Set(row.index_names || [])
    const missingColumns = REQUIRED_PADDLE_WEBHOOK_INBOX_COLUMNS.filter((column) => !columns.has(column))
    const missingIndexes = REQUIRED_PADDLE_WEBHOOK_INBOX_INDEXES.filter((index) => !indexes.has(index))
    const tableExists = row.table_exists === true
    const errors = []

    if (!tableExists) {
      errors.push({
        code: 'PADDLE_WEBHOOK_INBOX_TABLE_MISSING',
        message: 'The durable Paddle webhook inbox table is missing. Apply migrations 050 through 052.',
      })
    } else {
      if (missingColumns.length > 0) {
        errors.push({
          code: 'PADDLE_WEBHOOK_INBOX_COLUMNS_MISSING',
          message: `The durable Paddle webhook inbox is missing required columns: ${missingColumns.join(', ')}.`,
        })
      }
      if (missingIndexes.length > 0) {
        errors.push({
          code: 'PADDLE_WEBHOOK_INBOX_INDEXES_MISSING',
          message: `The durable Paddle webhook inbox is missing required indexes: ${missingIndexes.join(', ')}.`,
        })
      }
    }

    return {
      ready: errors.length === 0,
      tableExists,
      missingColumns,
      missingIndexes,
      errors,
    }
  } catch (error) {
    return {
      ready: false,
      tableExists: false,
      missingColumns: [],
      missingIndexes: [],
      errors: [{
        code: 'PADDLE_WEBHOOK_INBOX_SCHEMA_CHECK_FAILED',
        message: 'The durable Paddle webhook inbox schema could not be verified.',
      }],
    }
  }
}

export function setPaddleWebhookWorkerState(nextState = {}) {
  workerState = {
    ready: Boolean(nextState.ready),
    status: nextState.status || (nextState.ready ? 'running' : 'failed'),
    errorCode: nextState.errorCode || null,
    checkedAt: new Date().toISOString(),
  }
  return { ...workerState }
}

export function getPaddleWebhookWorkerState() {
  return { ...workerState }
}

export async function checkPaddleBillingReadiness({
  env = process.env,
  db,
  requireWorkerRuntime = true,
} = {}) {
  const configuration = inspectPaddleBillingConfiguration(env)
  if (!configuration.paddleEnabled) {
    return {
      enabled: false,
      ready: true,
      environments: [],
      durableInbox: { configured: false, schemaReady: null },
      worker: { required: false, ready: null, status: 'not_required' },
      errors: [],
    }
  }

  const schema = db
    ? await verifyPaddleWebhookInboxSchema(db)
    : {
        ready: false,
        errors: [{
          code: 'PADDLE_WEBHOOK_INBOX_DATABASE_UNAVAILABLE',
          message: 'The durable Paddle webhook inbox database connection is unavailable.',
        }],
      }
  const currentWorkerState = getPaddleWebhookWorkerState()
  const runtimeErrors = requireWorkerRuntime && !currentWorkerState.ready
    ? [{
        code: 'PADDLE_WEBHOOK_RETRY_WORKER_NOT_READY',
        message: 'The durable Paddle webhook retry worker is not ready.',
      }]
    : []
  const errors = [...configuration.errors, ...schema.errors, ...runtimeErrors]

  return {
    enabled: true,
    ready: errors.length === 0,
    environments: configuration.environments,
    durableInbox: {
      configured: configuration.durableInboxEnabled,
      schemaReady: schema.ready,
    },
    worker: {
      required: true,
      configured: configuration.retryWorkerEnabled,
      ready: requireWorkerRuntime ? currentWorkerState.ready : null,
      status: requireWorkerRuntime ? currentWorkerState.status : 'startup_pending',
    },
    errors,
  }
}

export async function assertPaddleBillingPrerequisites({ env = process.env, db } = {}) {
  const readiness = await checkPaddleBillingReadiness({ env, db, requireWorkerRuntime: false })
  if (!readiness.ready) {
    const error = new Error(
      `Paddle billing readiness prerequisites failed: ${readiness.errors.map((item) => item.code).join(', ')}`,
    )
    error.code = 'PADDLE_BILLING_NOT_READY'
    error.readiness = readiness
    throw error
  }
  return readiness
}
