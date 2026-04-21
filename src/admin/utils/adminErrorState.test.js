import test from 'node:test'
import assert from 'node:assert/strict'
import { adminFetchJson, handleAdminUnauthorized, redirectToAdminLogin } from './adminErrorState.js'
import { shouldVerifyAdminSessionOnVisibility } from './adminSessionLifecycle.js'

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
}

function createWindow(pathname = '/admin/analytics') {
  const listeners = new Map()
  const location = {
    href: `https://hireflow.test${pathname}`,
    pathname,
    search: '',
  }

  return {
    location,
    history: {
      pushState: (_state, _title, nextPath) => {
        const [nextPathname, nextSearch = ''] = String(nextPath).split('?')
        location.pathname = nextPathname
        location.search = nextSearch ? `?${nextSearch}` : ''
        location.href = `https://hireflow.test${location.pathname}${location.search}`
      },
    },
    setTimeout: (fn) => fn(),
    addEventListener: (type, fn) => {
      const list = listeners.get(type) || []
      list.push(fn)
      listeners.set(type, list)
    },
    dispatchEvent: (event) => {
      const list = listeners.get(event.type) || []
      list.forEach((fn) => fn(event))
      return true
    },
    PopStateEvent: class PopStateEvent {
      constructor(type) {
        this.type = type
      }
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type
        this.detail = options.detail
      }
    },
  }
}

test('expired cookie + stale localStorage clears admin keys and redirects to login', () => {
  const storage = createStorage({ admin_session: '{"stale":true}', admin_id: '42' })
  const windowRef = createWindow('/admin/users')

  handleAdminUnauthorized({ reason: 'timeout' }, { storage, windowRef })

  assert.equal(storage.getItem('admin_session'), null)
  assert.equal(storage.getItem('admin_id'), null)
  assert.equal(windowRef.location.pathname, '/admin/login')
  assert.match(windowRef.location.search, /reason=timeout/)
})

test('401 from admin API triggers session expiry flow', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalStorage = globalThis.localStorage
  const originalPopState = globalThis.PopStateEvent

  const storage = createStorage({ admin_session: '{"x":1}', admin_id: '7' })
  const windowRef = createWindow('/admin/analytics')

  let sessionExpiredEventCount = 0
  windowRef.addEventListener('admin-session-expired', () => {
    sessionExpiredEventCount += 1
  })

  globalThis.window = windowRef
  globalThis.localStorage = storage
  globalThis.PopStateEvent = class PopStateEvent {
    constructor(type) {
      this.type = type
    }
  }
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: async () => ({ error: 'Unauthorized' }),
  })

  try {
    await assert.rejects(() => adminFetchJson('https://hireflow.test/api/admin/users'))
    assert.equal(sessionExpiredEventCount, 1)
    assert.equal(storage.getItem('admin_session'), null)
    assert.equal(windowRef.location.pathname, '/admin/login')
  } finally {
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
    globalThis.localStorage = originalStorage
    globalThis.PopStateEvent = originalPopState
  }
})

test('background tab resume check only runs for visible admin routes', () => {
  assert.equal(
    shouldVerifyAdminSessionOnVisibility({ visibilityState: 'visible', pathname: '/admin/health' }),
    true,
  )
  assert.equal(
    shouldVerifyAdminSessionOnVisibility({ visibilityState: 'hidden', pathname: '/admin/health' }),
    false,
  )
  assert.equal(
    shouldVerifyAdminSessionOnVisibility({ visibilityState: 'visible', pathname: '/pricing' }),
    false,
  )
})

test('redirectToAdminLogin appends timeout reason message', () => {
  const windowRef = createWindow('/admin/users')
  redirectToAdminLogin({ reason: 'invalid_session', message: 'Please sign in to continue.' }, { windowRef })
  assert.equal(windowRef.location.pathname, '/admin/login')
  assert.match(windowRef.location.search, /reason=invalid_session/)
})
