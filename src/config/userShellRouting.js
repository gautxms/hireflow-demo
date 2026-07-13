const WORKSPACE_ROUTE_PATHS = new Set([
  '/dashboard',
  '/dashboard/legacy',
  '/job-descriptions',
  '/jobs',
  '/analyses',
  '/candidates',
  '/shortlists',
  '/reports',
  '/uploader',
  '/create-analysis',
])

const ACCOUNT_ROUTE_PATHS = new Set(['/settings', '/billing', '/account'])
const CHECKOUT_RETURN_ROUTE_PATHS = new Set(['/account/payment-method'])

export function normalizeLegacyAccountPath(pathname, search = '') {
  if (pathname !== '/account') return null
  const params = new URLSearchParams(search || '')
  const nextParams = new URLSearchParams()
  const upgradeTestKey = params.get('upgradeTestKey')
  if (upgradeTestKey) nextParams.set('upgradeTestKey', upgradeTestKey)
  const query = nextParams.toString()
  return `/settings${query ? `?${query}` : ''}`
}

export function isPaidWorkspaceRoutePath(pathname) {
  return WORKSPACE_ROUTE_PATHS.has(pathname)
}

export function isAuthenticatedAccountRoutePath(pathname) {
  return ACCOUNT_ROUTE_PATHS.has(pathname)
}

export function isAuthenticatedHistoricalRoutePath(pathname) {
  if (pathname === '/results') return true
  if (pathname.startsWith('/analyses/')) return pathname.split('/').filter(Boolean).length === 2
  if (pathname.startsWith('/candidates/')) return pathname.split('/').filter(Boolean).length === 2
  return false
}

export function isCheckoutReturnRoutePath(pathname) {
  return CHECKOUT_RETURN_ROUTE_PATHS.has(pathname)
}

export function isCheckoutStandaloneRoutePath(pathname) {
  return pathname === '/checkout' || pathname === '/billing/success' || pathname === '/billing/cancel'
}

export function isAuthenticatedAccountShellRoutePath(pathname) {
  return isAuthenticatedAccountRoutePath(pathname) || isAuthenticatedHistoricalRoutePath(pathname)
}

// These routes are eligible for an authenticated app shell. Routing decides
// between the full workspace shell and account-only shell after consuming
// resolveSubscriptionState(...).canAccessProductDashboard.
export function isUserShellRoutePath(pathname) {
  return isPaidWorkspaceRoutePath(pathname)
    || isAuthenticatedAccountRoutePath(pathname)
    || isAuthenticatedHistoricalRoutePath(pathname)
    || isCheckoutReturnRoutePath(pathname)
}
