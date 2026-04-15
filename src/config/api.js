const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4000'
const DEFAULT_PROD_API_BASE_URL = '/api'

function normalizeBaseUrl(url) {
  const trimmed = String(url || '').trim()

  if (!trimmed) {
    return ''
  }

  return trimmed === '/api' ? '/api' : trimmed.replace(/\/+$/, '')
}

function ensureApiPath(baseUrl) {
  if (!baseUrl) {
    return ''
  }

  if (baseUrl === '/api' || baseUrl.endsWith('/api')) {
    return baseUrl
  }

  return `${baseUrl}/api`
}

function resolveApiBase() {
  const configuredBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)

  if (configuredBase) {
    return ensureApiPath(configuredBase)
  }

  const fallbackBase = import.meta.env.PROD ? DEFAULT_PROD_API_BASE_URL : DEFAULT_DEV_API_BASE_URL
  return ensureApiPath(normalizeBaseUrl(fallbackBase))
}

const API_BASE = resolveApiBase()

export default API_BASE
