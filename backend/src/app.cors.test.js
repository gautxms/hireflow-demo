import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import app, { buildAllowedOrigins, isCorsOriginAllowed } from './app.js'
import { pool } from './db/client.js'
import { parseQueue } from './services/jobQueue.js'
import {
  REQUIRED_PADDLE_WEBHOOK_INBOX_COLUMNS,
  REQUIRED_PADDLE_WEBHOOK_INBOX_INDEXES,
  setPaddleWebhookWorkerState,
} from './services/paddleBillingReadiness.js'

after(async () => {
  await parseQueue.close().catch(() => {})
})

function withCorsResponse(origin) {
  const allowedOrigins = buildAllowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://preview.example.com' })
  return isCorsOriginAllowed(origin, allowedOrigins)
}

test('CORS allows default local and production origins', () => {
  assert.equal(withCorsResponse('http://localhost:3000'), true)
  assert.equal(withCorsResponse('http://localhost:5173'), true)
  assert.equal(withCorsResponse('https://hireflow.dev'), true)
  assert.equal(withCorsResponse('https://www.hireflow.dev'), true)
})

test('CORS allows origins configured through FRONTEND_ORIGIN and CORS_ALLOWED_ORIGINS', () => {
  const allowedOrigins = buildAllowedOrigins({
    FRONTEND_ORIGIN: 'https://app.example.com, https://frontend.example.com',
    CORS_ALLOWED_ORIGINS: 'https://hireflow-git-preview.vercel.app, https://preview.example.com',
  })

  assert.equal(isCorsOriginAllowed('https://app.example.com', allowedOrigins), true)
  assert.equal(isCorsOriginAllowed('https://frontend.example.com', allowedOrigins), true)
  assert.equal(isCorsOriginAllowed('https://hireflow-git-preview.vercel.app', allowedOrigins), true)
  assert.equal(isCorsOriginAllowed('https://preview.example.com', allowedOrigins), true)
})

test('CORS blocks random Vercel and external origins by default', () => {
  const allowedOrigins = buildAllowedOrigins({})

  assert.equal(isCorsOriginAllowed('https://attacker.vercel.app', allowedOrigins), false)
  assert.equal(isCorsOriginAllowed('https://evil.example.com', allowedOrigins), false)
})

test('CORS allows no-origin requests for health checks and server-to-server clients', () => {
  assert.equal(isCorsOriginAllowed(undefined), true)
  assert.equal(isCorsOriginAllowed(null), true)
  assert.equal(isCorsOriginAllowed(''), true)
})

test('app still mounts routes and health endpoint responds to no-origin requests', async (t) => {
  t.mock.method(pool, 'query', async (queryText) => {
    const sql = String(queryText)

    if (sql.includes("column_name = 'profile_score'")) {
      return { rows: [{ has_profile_score: true }] }
    }

    if (sql.includes("column_name = 'years_experience'")) {
      return {
        rows: [{
          data_type: 'numeric',
          numeric_precision: 5,
          numeric_scale: 2,
          udt_name: 'numeric',
        }],
      }
    }

    throw new Error(`Unexpected SQL in CORS app test: ${sql}`)
  })

  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    const payload = await response.json()

    assert.equal(response.status, 200)
    assert.equal(payload.status, 'ok')
    assert.equal(payload.alive, true)
    assert.equal(payload.billing.enabled, false)
    assert.equal(payload.billing.ready, true)
  } finally {
    server.close()
  }
})

test('health distinguishes liveness from unavailable Paddle billing readiness', async (t) => {
  const original = {
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
    PADDLE_SANDBOX_WEBHOOK_SECRET: process.env.PADDLE_SANDBOX_WEBHOOK_SECRET,
    PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED: process.env.PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED,
    PADDLE_WEBHOOK_RETRY_WORKER_ENABLED: process.env.PADDLE_WEBHOOK_RETRY_WORKER_ENABLED,
  }
  Object.assign(process.env, {
    PADDLE_SANDBOX_API_KEY: 'sandbox-key',
    PADDLE_SANDBOX_WEBHOOK_SECRET: 'sandbox-secret',
    PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED: 'true',
    PADDLE_WEBHOOK_RETRY_WORKER_ENABLED: 'true',
  })
  setPaddleWebhookWorkerState({ ready: false, status: 'failed', errorCode: 'TEST_FAILURE' })
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  t.mock.method(pool, 'query', async (queryText) => {
    const sql = String(queryText)
    if (sql.includes("column_name = 'profile_score'")) {
      return { rows: [{ has_profile_score: true }] }
    }
    if (sql.includes("column_name = 'years_experience'")) {
      return { rows: [{ data_type: 'numeric', numeric_precision: 5, numeric_scale: 2 }] }
    }
    if (sql.includes("table_name = 'shortlist_candidates'")) {
      return {
        rows: [
          { column_name: 'analysis_id', udt_name: 'uuid', data_type: 'uuid' },
          { column_name: 'candidate_snapshot', data_type: 'jsonb' },
          { column_name: 'source_context', data_type: 'jsonb' },
          { column_name: 'created_at', data_type: 'timestamp without time zone' },
          { column_name: 'updated_at', data_type: 'timestamp without time zone' },
        ],
      }
    }
    if (sql.includes("to_regclass('public.paddle_webhook_events')")) {
      return {
        rows: [{
          table_exists: true,
          column_names: REQUIRED_PADDLE_WEBHOOK_INBOX_COLUMNS,
          index_names: REQUIRED_PADDLE_WEBHOOK_INBOX_INDEXES,
        }],
      }
    }
    throw new Error(`Unexpected SQL in billing readiness health test: ${sql}`)
  })

  const server = app.listen(0)
  const port = server.address().port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    const payload = await response.json()
    assert.equal(response.status, 503)
    assert.equal(payload.status, 'not_ready')
    assert.equal(payload.alive, true)
    assert.equal(payload.billing.enabled, true)
    assert.equal(payload.billing.ready, false)
    assert.ok(payload.billing.errors.some((error) => error.code === 'PADDLE_WEBHOOK_RETRY_WORKER_NOT_READY'))
    assert.equal(JSON.stringify(payload).includes('TEST_FAILURE'), false)
  } finally {
    server.close()
  }
})
