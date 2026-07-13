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

export function canonicalizePathname(pathname = '/') {
  const normalized = String(pathname || '/').trim() || '/'
  if (normalized === '/') return '/'
  return normalized.replace(/\/+$/, '') || '/'
}

export function normalizeLegacyAccountPath(pathname, search = '') {
  const canonicalPathname = canonicalizePathname(pathname)
  if (canonicalPathname !== '/account') return null
  const params = new URLSearchParams(search || '')
  const nextParams = new URLSearchParams()
  const upgradeTestKey = params.get('upgradeTestKey')
  if (upgradeTestKey) nextParams.set('upgradeTestKey', upgradeTestKey)
  const query = nextParams.toString()
  return `/settings${query ? `?${query}` : ''}`
}

export function isPaidWorkspaceRoutePath(pathname) {
  return WORKSPACE_ROUTE_PATHS.has(canonicalizePathname(pathname))
}

export function isAuthenticatedAccountRoutePath(pathname) {
  return ACCOUNT_ROUTE_PATHS.has(canonicalizePathname(pathname))
}

function getTwoSegmentDetailId(pathname, basePath) {
  const canonicalPathname = canonicalizePathname(pathname)
  const segments = canonicalPathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments[0] !== basePath.replace('/', '')) {
    return null
  }
  return segments[1] || null
}

export function getAnalysisDetailRouteId(pathname) {
  return getTwoSegmentDetailId(pathname, '/analyses')
}

export function getCandidateDetailRouteId(pathname) {
  return getTwoSegmentDetailId(pathname, '/candidates')
}

export function isAnalysisDetailRoutePath(pathname) {
  return Boolean(getAnalysisDetailRouteId(pathname))
}

export function isCandidateDetailRoutePath(pathname) {
  return Boolean(getCandidateDetailRouteId(pathname))
}

export function isAuthenticatedHistoricalRoutePath(pathname) {
  const canonicalPathname = canonicalizePathname(pathname)
  return canonicalPathname === '/results' || isAnalysisDetailRoutePath(canonicalPathname) || isCandidateDetailRoutePath(canonicalPathname)
}

export function isCheckoutReturnRoutePath(pathname) {
  return CHECKOUT_RETURN_ROUTE_PATHS.has(canonicalizePathname(pathname))
}

export function isCheckoutStandaloneRoutePath(pathname) {
  const canonicalPathname = canonicalizePathname(pathname)
  return canonicalPathname === '/checkout' || canonicalPathname === '/billing/success' || canonicalPathname === '/billing/cancel'
}

export function isAdminStandaloneRoutePath(pathname) {
  const canonicalPathname = canonicalizePathname(pathname)
  return canonicalPathname === '/admin' || canonicalPathname.startsWith('/admin/')
}

export function isStandaloneOrdinaryUserAuthRoutePath(pathname) {
  const canonicalPathname = canonicalizePathname(pathname)
  return canonicalPathname.startsWith('/results/') || isCheckoutStandaloneRoutePath(canonicalPathname) || isAdminStandaloneRoutePath(canonicalPathname)
}

export function isAuthenticatedAccountShellRoutePath(pathname) {
  const canonicalPathname = canonicalizePathname(pathname)
  return isAuthenticatedAccountRoutePath(canonicalPathname) || isAuthenticatedHistoricalRoutePath(canonicalPathname)
}

// These routes are eligible for an authenticated app shell. Routing decides
// between the full workspace shell and account-only shell after consuming
// resolveSubscriptionState(...).canAccessProductDashboard.
export function isUserShellRoutePath(pathname) {
  const canonicalPathname = canonicalizePathname(pathname)
  return isPaidWorkspaceRoutePath(canonicalPathname)
    || isAuthenticatedAccountRoutePath(canonicalPathname)
    || isAuthenticatedHistoricalRoutePath(canonicalPathname)
    || isCheckoutReturnRoutePath(canonicalPathname)
}
