import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import cookieParser from 'cookie-parser'
import router from './googleAuth.js'
import { pool } from '../db/client.js'
import { googleIdentity } from '../services/googleIdentity.js'
import { hashPassword } from '../services/passwordHash.js'

async function withApp(run) {
  const app = express()
  app.use(cookieParser())
  app.use(express.json())
  app.use('/api/auth/google', router)
  const server = app.listen(0)
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/auth/google`
    const csrf = await fetch(`${base}/csrf`)
    assert.equal(csrf.status, 200)
    const { csrfToken } = await csrf.json()
    const cookie = csrf.headers.get('set-cookie').split(';')[0]
    const post = async (path, body, headers = {}) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          Cookie: cookie,
          'X-HireFlow-Google-CSRF': csrfToken,
          ...headers,
        },
        body: JSON.stringify(body),
      })
      return { response, body: await response.json() }
    }
    await run({ post, base, csrfToken, cookie })
  } finally {
    server.close()
  }
}

function setup(t) {
  t.mock.method(googleIdentity, 'verify', async () => ({
    subject: 'google-sub-1', email: 'recruiter@example.com',
  }))
  t.mock.method(pool, 'query', async () => ({ rows: [] }))
  process.env.GOOGLE_AUTH_ENABLED = 'true'
  process.env.GOOGLE_CLIENT_ID = 'google-client-id'
  process.env.JWT_SECRET = 'test-google-secret'
  t.after(() => {
    delete process.env.GOOGLE_AUTH_ENABLED
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.JWT_SECRET
  })
}

test('Google credential requires matching browser origin and CSRF token', async (t) => {
  setup(t)
  await withApp(async ({ post }) => {
    const forged = await post('', { credential: 'valid' }, { 'X-HireFlow-Google-CSRF': 'wrong' })
    assert.equal(forged.response.status, 403)
    const wrongOrigin = await post('', { credential: 'valid' }, { Origin: 'https://evil.example' })
    assert.equal(wrongOrigin.response.status, 403)
    const valid = await post('', { credential: 'valid' })
    assert.equal(valid.response.status, 200)
    assert.equal(valid.body.status, 'signup_required')
    assert.equal(valid.body.email, 'recruiter@example.com')
    assert.ok(valid.body.continuationToken)
  })
})

test('returning Google identity issues the existing HireFlow session', async (t) => {
  setup(t)
  const user = {
    id: 42, email: 'recruiter@example.com', email_verified: true,
    subscription_status: 'active', created_at: new Date().toISOString(),
    deleted_at: null, is_admin: false,
  }
  pool.query.mock.mockImplementation(async (sql) => (
    sql.includes('FROM user_auth_identities i') ? { rows: [user] } : { rows: [] }
  ))
  await withApp(async ({ post }) => {
    const { response, body } = await post('', { credential: 'valid' })
    assert.equal(response.status, 200)
    assert.equal(body.user.id, 42)
    assert.equal(body.user.subscription_status, 'active')
    assert.ok(body.token)
    assert.match(response.headers.get('set-cookie'), /token=/)
  })
})

test('matching email requests proof of account ownership before linking', async (t) => {
  setup(t)
  let released = false
  let eventAfterRelease = false
  const user = {
    id: 42, email: 'recruiter@example.com', password_hash: hashPassword('correct-password'),
    password_login_enabled: true, email_verified: true, subscription_status: 'active',
    is_admin: false, deleted_at: null,
  }
  pool.query.mock.mockImplementation(async (sql) => {
    if (sql.includes('INSERT INTO events')) eventAfterRelease = released
    return sql.includes('FROM users WHERE email') ? { rows: [user] } : { rows: [] }
  })
  const queries = []
  t.mock.method(pool, 'connect', async () => ({
    async query(sql) {
      queries.push(sql)
      return sql.includes('FROM users WHERE email') ? { rows: [user] } : { rows: [] }
    },
    release() { released = true },
  }))
  await withApp(async ({ post }) => {
    const first = await post('', { credential: 'valid' })
    assert.equal(first.body.status, 'link_required')
    const wrong = await post('/link', { continuationToken: first.body.continuationToken, password: 'wrong' })
    assert.equal(wrong.response.status, 401)
    assert.equal(queries.some((sql) => sql.includes('INSERT INTO user_auth_identities')), false)
    const linked = await post('/link', { continuationToken: first.body.continuationToken, password: 'correct-password' })
    assert.equal(linked.response.status, 200)
    assert.equal(linked.body.user.id, 42)
    assert.ok(queries.some((sql) => sql.includes('INSERT INTO user_auth_identities')))
    assert.equal(eventAfterRelease, true)
  })
})

test('new Google signup requires explicit terms and creates a disabled password login', async (t) => {
  setup(t)
  let released = false
  let eventAfterRelease = false
  pool.query.mock.mockImplementation(async (sql) => {
    if (sql.includes('INSERT INTO events')) eventAfterRelease = released
    return { rows: [] }
  })
  const queries = []
  const user = {
    id: 43, email: 'recruiter@example.com', email_verified: true,
    subscription_status: 'inactive', created_at: new Date().toISOString(),
  }
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, params) {
      queries.push({ sql, params })
      return sql.includes('INSERT INTO users') ? { rows: [user] } : { rows: [] }
    },
    release() { released = true },
  }))
  await withApp(async ({ post }) => {
    const first = await post('', { credential: 'valid' })
    const missing = await post('/signup', { continuationToken: first.body.continuationToken })
    assert.equal(missing.response.status, 400)
    assert.equal(queries.length, 0)
    const created = await post('/signup', { continuationToken: first.body.continuationToken, acceptTerms: true })
    assert.equal(created.response.status, 200)
    assert.equal(created.body.user.email_verified, true)
    const insert = queries.find(({ sql }) => sql.includes('INSERT INTO users'))
    assert.match(insert.sql, /false, true/)
    assert.equal(insert.params[0], user.email)
    assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO user_auth_identities')))
    assert.ok(queries.some(({ sql }) => sql === 'COMMIT'))
    assert.equal(eventAfterRelease, true)
  })
})

test('rejects invalid Google credentials before reading or creating users', async (t) => {
  setup(t)
  googleIdentity.verify.mock.mockImplementation(async () => { throw new Error('invalid signature') })
  await withApp(async ({ post }) => {
    const result = await post('', { credential: 'forged' })
    assert.equal(result.response.status, 401)
    assert.equal(pool.query.mock.callCount(), 0)
  })
})

test('blocks a deleted or admin Google account from receiving a session', async (t) => {
  setup(t)
  pool.query.mock.mockImplementation(async (sql) => (
    sql.includes('FROM user_auth_identities i')
      ? { rows: [{ id: 44, deleted_at: new Date(), is_admin: false }] }
      : { rows: [] }
  ))
  await withApp(async ({ post }) => {
    const result = await post('', { credential: 'valid' })
    assert.equal(result.response.status, 403)
    assert.equal(result.body.token, undefined)
  })
})

test('rejects an expired or unrelated continuation token', async (t) => {
  setup(t)
  t.mock.method(pool, 'connect', async () => { throw new Error('Database should not be reached') })
  await withApp(async ({ post }) => {
    const expired = await post('/signup', { continuationToken: 'bad-token', acceptTerms: true })
    const wrongPurpose = await post('/link', { continuationToken: 'bad-token', password: 'something' })
    assert.equal(expired.response.status, 401)
    assert.equal(wrongPurpose.response.status, 401)
    assert.equal(pool.connect.mock.callCount(), 0)
  })
})
