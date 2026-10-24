import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { hasNoindexHeader } from './vercel-route-patterns.mjs'

const vercelConfig = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))

test('private rewrite paths receive noindex response headers', () => {
  for (const pathname of ['/login', '/signup', '/dashboard', '/dashboard/legacy', '/dashboard/anything', '/admin', '/admin/users', '/account', '/account/settings', '/billing', '/billing/success', '/results', '/results/example', '/analyses', '/analyses/example', '/candidates', '/candidates/example']) {
    assert.equal(hasNoindexHeader(vercelConfig, pathname), true, pathname)
  }
})

test('public paths do not receive private-route noindex response headers', () => {
  for (const pathname of ['/', '/pricing', '/about', '/privacy', '/trust', '/ai-resume-screening']) {
    assert.equal(hasNoindexHeader(vercelConfig, pathname), false, pathname)
  }
})

test('dashboard descendant coverage is required, not merely a source containing dashboard', () => {
  const withoutDashboardDescendants = {
    ...vercelConfig,
    headers: vercelConfig.headers.filter(({ source }) => source !== '/(reset-password|dashboard|results|analyses|candidates|admin)/(.*)'),
  }
  assert.equal(hasNoindexHeader(withoutDashboardDescendants, '/dashboard'), true)
  assert.equal(hasNoindexHeader(withoutDashboardDescendants, '/dashboard/legacy'), false)
})

test('MCP discovery, OAuth, and transport routes proxy to the production backend before SPA rewrites', () => {
  assert.deepEqual(vercelConfig.rewrites.slice(0, 4), [
    {
      source: '/.well-known/oauth-protected-resource',
      destination: 'https://hireflow-backend-production.up.railway.app/.well-known/oauth-protected-resource',
    },
    {
      source: '/.well-known/oauth-authorization-server',
      destination: 'https://hireflow-backend-production.up.railway.app/.well-known/oauth-authorization-server',
    },
    {
      source: '/oauth/(.*)',
      destination: 'https://hireflow-backend-production.up.railway.app/oauth/$1',
    },
    {
      source: '/mcp',
      destination: 'https://hireflow-backend-production.up.railway.app/mcp',
    },
  ])
})
