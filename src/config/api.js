const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4000'
const DEFAULT_PROD_API_BASE_URL = 'https://hireflow-backend-production.up.railway.app'

function normalizeBaseUrl(url) {
  const trimmed = String(url || '').trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.replace(/\/+$/, '')
}

function resolveApiBase() {
  const configuredBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)

  if (configuredBase) {
    return configuredBase.endsWith('/api') ? configuredBase : `${configuredBase}/api`
  }

  const fallbackBase = import.meta.env.PROD ? DEFAULT_PROD_API_BASE_URL : DEFAULT_DEV_API_BASE_URL
  return `${normalizeBaseUrl(fallbackBase)}/api`
}

const API_BASE = resolveApiBase()

export default API_BASE
