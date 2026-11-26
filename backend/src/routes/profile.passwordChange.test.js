import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import profileRouter from './profile.js'
import { pool } from '../db/client.js'
import { hashPassword, verifyPassword } from '../services/passwordHash.js'

process.env.JWT_SECRET = 'profile-password-test-secret'

async function request(method, path, body) {
  const app = express()
  app.use(express.json())
  app.use('/profile', profileRouter)
  const server = app.listen(0)
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt.sign({ userId: 40, user: { id: 40 } }, process.env.JWT_SECRET)}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, payload: await response.json() }
  } finally {
    server.close()
  }
}

const change = (oldPassword = 'old password', newPassword = 'new password') => request('POST', '/profile/change-password', {
  oldPassword, newPassword, confirmPassword: newPassword,
})

test('password change verifies PBKDF2 and writes a hash accepted by normal login', async (t) => {
  const oldHash = hashPassword('old password')
  let nextHash
  t.mock.method(pool, 'query', async (sql, params) => {
    if (sql.startsWith('SELECT password_hash')) return { rows: [{ password_hash: oldHash, password_login_enabled: true }] }
    assert.match(sql, /WHERE id = \$2 AND password_hash = \$3/)
    assert.equal(params[1], 40)
    assert.equal(params[2], oldHash)
    nextHash = params[0]
    return { rowCount: 1 }
  })
  assert.equal((await change()).status, 200)
  assert.equal(verifyPassword('new password', nextHash), true)
  assert.equal(verifyPassword('old password', nextHash), false)
})

test('wrong current password does not update the account', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    assert.match(sql, /^SELECT password_hash/)
    return { rows: [{ password_hash: hashPassword('correct password'), password_login_enabled: true }] }
  })
  const result = await change()
  assert.equal(result.status, 400)
  assert.match(result.payload.error, /Old password is incorrect/)
})

test('Google-only account cannot change an unusable password', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    assert.match(sql, /^SELECT password_hash/)
    return { rows: [{ password_hash: hashPassword('random stored value'), password_login_enabled: false }] }
  })
  const result = await change()
  assert.equal(result.status, 400)
  assert.match(result.payload.error, /Google sign-in/)
})

test('legacy crypt hash is accepted once and upgraded to PBKDF2', async (t) => {
  const oldHash = '$2a$10$legacyhash'
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push(sql)
    if (sql.startsWith('SELECT password_hash')) return { rows: [{ password_hash: oldHash, password_login_enabled: true }] }
    if (sql.startsWith('SELECT crypt')) {
      assert.deepEqual(params, ['old password', oldHash])
      return { rows: [{ is_valid: true }] }
    }
    assert.equal(params[2], oldHash)
    assert.equal(verifyPassword('new password', params[0]), true)
    return { rowCount: 1 }
  })
  assert.equal((await change()).status, 200)
  assert.equal(queries.length, 3)
})

test('concurrent password change does not overwrite newer hash', async (t) => {
  t.mock.method(pool, 'query', async (sql) => sql.startsWith('SELECT password_hash')
    ? { rows: [{ password_hash: hashPassword('old password'), password_login_enabled: true }] }
    : { rowCount: 0 })
  assert.equal((await change()).status, 409)
})

test('profile reports password and Google connection without exposing the hash', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    assert.match(sql, /password_login_enabled/)
    assert.match(sql, /user_auth_identities/)
    assert.doesNotMatch(sql, /SELECT[^;]*password_hash/i)
    return { rows: [{ id: 40, email: 'google@example.com', password_login_enabled: false, google_connected: true }] }
  })
  const result = await request('GET', '/profile/me')
  assert.equal(result.status, 200)
  assert.equal(result.payload.user.password_login_enabled, false)
  assert.equal(result.payload.user.google_connected, true)
  assert.equal('password_hash' in result.payload.user, false)
})
