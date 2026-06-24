import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import app, { buildAllowedOrigins, isCorsOriginAllowed } from './app.js'
import { pool } from './db/client.js'
import { parseQueue } from './services/jobQueue.js'

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
  } finally {
    server.close()
  }
})
