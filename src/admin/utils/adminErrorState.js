const ADMIN_SESSION_STORAGE_KEY = 'admin_session'
const ADMIN_SESSION_EXPIRED_EVENT = 'admin-session-expired'

export function clearAdminSessionStorage(storage = globalThis?.localStorage) {
  if (!storage) return
  storage.removeItem(ADMIN_SESSION_STORAGE_KEY)
  storage.removeItem('admin_id')
}

export function redirectToAdminLogin({ reason = 'timeout', message = 'Your admin session expired. Please sign in again.' } = {}, env = {}) {
  const windowRef = env.windowRef || globalThis?.window

  if (!windowRef?.history || !windowRef?.location) {
    return
  }

  const url = new URL(windowRef.location.href)
  url.pathname = '/admin/login'
  url.search = ''
  url.searchParams.set('reason', reason)
  if (message) {
    url.searchParams.set('message', message)
  }

  const nextPath = `${url.pathname}?${url.searchParams.toString()}`
  const currentPath = `${windowRef.location.pathname}${windowRef.location.search}`

  if (currentPath !== nextPath) {
    const PopStateCtor = windowRef.PopStateEvent || globalThis.PopStateEvent
    windowRef.history.pushState({}, '', nextPath)
    if (typeof PopStateCtor === 'function') {
      windowRef.dispatchEvent(new PopStateCtor('popstate'))
    }
  }
}

export function handleAdminUnauthorized({ reason = 'timeout', message = 'Your admin session expired. Please sign in again.' } = {}, env = {}) {
  const storage = env.storage || globalThis?.localStorage
  const windowRef = env.windowRef || globalThis?.window

  clearAdminSessionStorage(storage)

  if (windowRef?.dispatchEvent && typeof windowRef.CustomEvent === 'function') {
    windowRef.dispatchEvent(new windowRef.CustomEvent(ADMIN_SESSION_EXPIRED_EVENT, {
      detail: { reason, message },
    }))
  }

  windowRef?.setTimeout?.(() => {
    redirectToAdminLogin({ reason, message }, { windowRef })
  }, 0)
}

export function mapAdminError({ status, code = '', message = '' } = {}) {
  const normalizedCode = String(code || '').toLowerCase()
  const normalizedMessage = String(message || '').toLowerCase()

  const isAuth = status === 401 || normalizedCode.includes('auth') || normalizedMessage.includes('unauthorized')
  if (isAuth) {
    return {
      title: 'Authentication required',
      cause: 'Your admin session has expired or you are not signed in.',
      impact: 'We cannot load protected admin data.',
      nextAction: 'Sign in again, then retry.',
      canRetry: true,
    }
  }

  const isForbidden = status === 403 || normalizedCode.includes('forbidden')
  if (isForbidden) {
    return {
      title: 'Insufficient permissions',
      cause: 'This account does not have permission for this admin resource.',
      impact: 'The requested data is hidden.',
      nextAction: 'Use an account with the required access or contact an administrator.',
      canRetry: false,
    }
  }

  const isMissingSchema = status === 422 || normalizedCode.includes('schema') || normalizedMessage.includes('schema')
  if (isMissingSchema) {
    return {
      title: 'Data schema mismatch',
      cause: 'The backend response format is missing required fields.',
      impact: 'This widget cannot render safely.',
      nextAction: 'Run the latest backend migrations/deploy and retry.',
      canRetry: true,
    }
  }

  const isTimeout = status === 408 || status === 504 || normalizedCode.includes('timeout') || normalizedMessage.includes('timed out')
  if (isTimeout) {
    return {
      title: 'Request timed out',
      cause: 'The server took too long to respond.',
      impact: 'No fresh data was returned.',
      nextAction: 'Retry now. If this keeps happening, narrow filters and try again.',
      canRetry: true,
    }
  }

  return {
    title: 'Unable to load data',
    cause: 'The server returned an unexpected response for this request.',
    impact: 'This section may be incomplete.',
    nextAction: 'Retry. If the problem continues, contact support.',
    canRetry: true,
  }
}

export async function adminFetchJson(url, options = {}) {
  const requestOptions = typeof options === 'string' ? {} : options
  const response = await fetch(url, {
    credentials: 'include',
    ...requestOptions,
    headers: {
      ...(requestOptions.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    if (response.status === 401) {
      handleAdminUnauthorized()
    }

    const mapped = mapAdminError({
      status: response.status,
      code: payload.code || payload.errorCode,
      message: payload.error || payload.message || response.statusText,
    })
    const error = new Error(mapped.title)
    error.mapped = mapped
    error.status = response.status
    error.payload = payload
    throw error
  }

  return payload
}

export function getMappedError(error) {
  if (error?.mapped) return error.mapped
  return mapAdminError({ message: error?.message })
}

export { ADMIN_SESSION_EXPIRED_EVENT }
