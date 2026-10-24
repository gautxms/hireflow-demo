import test from 'node:test'
import assert from 'node:assert/strict'
import { getSafeOAuthReturnTo } from './oauthReturnTo.js'

test('OAuth login return target accepts only the same-origin authorize endpoint', () => {
  const authorize = '/oauth/authorize?client_id=chatgpt&state=opaque'
  const location = {
    origin: 'https://hireflow.dev',
    search: `?returnTo=${encodeURIComponent(authorize)}`,
  }
  assert.equal(getSafeOAuthReturnTo(location), authorize)

  assert.equal(getSafeOAuthReturnTo({
    origin: 'https://hireflow.dev',
    search: `?returnTo=${encodeURIComponent('https://evil.example/oauth/authorize')}`,
  }), '')
  assert.equal(getSafeOAuthReturnTo({
    origin: 'https://hireflow.dev',
    search: `?returnTo=${encodeURIComponent('/dashboard')}`,
  }), '')
})
