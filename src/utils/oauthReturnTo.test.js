import test from 'node:test'
import assert from 'node:assert/strict'
import { getSafeOAuthReturnTo, shouldRedirectAuthenticatedAuthRoute } from './oauthReturnTo.js'

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

test('an existing local session does not skip the same-origin OAuth login', () => {
  assert.equal(shouldRedirectAuthenticatedAuthRoute({
    isAuthenticated: true,
    pathname: '/login',
    oauthReturnTo: '/oauth/authorize?state=opaque',
  }), false)
  assert.equal(shouldRedirectAuthenticatedAuthRoute({
    isAuthenticated: true,
    pathname: '/login',
    oauthReturnTo: '',
  }), true)
  assert.equal(shouldRedirectAuthenticatedAuthRoute({
    isAuthenticated: true,
    pathname: '/signup',
    oauthReturnTo: '/oauth/authorize?state=opaque',
  }), true)
})
