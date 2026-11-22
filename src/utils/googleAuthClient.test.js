import test from 'node:test'
import assert from 'node:assert/strict'
import { isGoogleAuthConfigured, submitGoogleAuth } from './googleAuthClient.js'

test('Google UI requires both a build gate and client ID', () => {
  assert.equal(isGoogleAuthConfigured({ VITE_GOOGLE_AUTH_ENABLED: 'false', VITE_GOOGLE_CLIENT_ID: 'id' }), false)
  assert.equal(isGoogleAuthConfigured({ VITE_GOOGLE_AUTH_ENABLED: 'true', VITE_GOOGLE_CLIENT_ID: '' }), false)
  assert.equal(isGoogleAuthConfigured({ VITE_GOOGLE_AUTH_ENABLED: 'true', VITE_GOOGLE_CLIENT_ID: 'id' }), true)
})

test('Google request obtains CSRF on same origin and posts credentials with matching header', async () => {
  const calls = []
  const fakeFetch = async (path, options) => {
    calls.push({ path, options })
    return { ok: true, json: async () => calls.length === 1 ? { csrfToken: 'csrf' } : { status: 'signup_required' } }
  }
  assert.deepEqual(await submitGoogleAuth('', { credential: 'google-id-token' }, fakeFetch), { status: 'signup_required' })
  assert.deepEqual(calls[0], { path: '/api/auth/google/csrf', options: { credentials: 'include' } })
  assert.equal(calls[1].path, '/api/auth/google')
  assert.equal(calls[1].options.credentials, 'include')
  assert.equal(calls[1].options.headers['X-HireFlow-Google-CSRF'], 'csrf')
  assert.deepEqual(JSON.parse(calls[1].options.body), { credential: 'google-id-token' })
})

test('Google signup forwards explicit consent and keeps continuation in request body', async () => {
  const calls = []
  const fakeFetch = async (path, options) => {
    calls.push({ path, options })
    return { ok: true, json: async () => calls.length === 1 ? { csrfToken: 'csrf' } : { token: 'session' } }
  }
  await submitGoogleAuth('/signup', { continuationToken: 'pending', acceptTerms: true }, fakeFetch)
  assert.equal(calls[1].path, '/api/auth/google/signup')
  assert.deepEqual(JSON.parse(calls[1].options.body), { continuationToken: 'pending', acceptTerms: true })
})

test('Google request stops if CSRF initialization fails', async () => {
  let requests = 0
  await assert.rejects(submitGoogleAuth('/link', {}, async () => {
    requests += 1
    return { ok: false, json: async () => ({ error: 'Not found' }) }
  }), /Not found/)
  assert.equal(requests, 1)
})
