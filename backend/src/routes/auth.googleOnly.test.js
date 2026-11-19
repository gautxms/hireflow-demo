import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import authRouter from './auth.js'
import { pool } from '../db/client.js'
import { hashPassword } from '../services/passwordHash.js'

test('Google-only account cannot sign in with a password', async (t) => {
  process.env.JWT_SECRET = 'test-secret'
  t.mock.method(pool, 'query', async () => ({
    rows: [{
      id: 42,
      email: 'recruiter@example.com',
      password_hash: hashPassword('even-if-known'),
      password_login_enabled: false,
    }],
  }))
  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  const server = app.listen(0)
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'recruiter@example.com', password: 'even-if-known' }),
    })
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error, 'Invalid credentials')
  } finally {
    server.close()
  }
})
