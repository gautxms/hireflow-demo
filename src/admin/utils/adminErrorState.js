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

export async function adminFetchJson(url, _message, requestInit = {}) {
  const response = await fetch(url, { ...requestInit, credentials: 'include' })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const mapped = mapAdminError({
      status: response.status,
      code: payload.code || payload.errorCode,
      message: payload.error || payload.message || response.statusText,
    })
    const error = new Error(mapped.title)
    error.mapped = mapped
    throw error
  }

  return payload
}

export function getMappedError(error) {
  if (error?.mapped) return error.mapped
  return mapAdminError({ message: error?.message })
}
