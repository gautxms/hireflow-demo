// Account and Billing intentionally remain authenticated workspace-shell routes for
// non-subscribed users; product routes still apply subscription guards before use.
const USER_SHELL_ROUTE_PATHS = new Set([
  '/dashboard',
  '/dashboard/legacy',
  '/results',
  '/shortlists',
  '/job-descriptions',
  '/jobs',
  '/analyses',
  '/candidates',
  '/reports',
  '/account',
  '/settings',
  '/billing',
  '/account/payment-method',
])

export function isUserShellRoutePath(pathname) {
  if (USER_SHELL_ROUTE_PATHS.has(pathname)) {
    return true
  }

  return pathname.startsWith('/analyses/')
    || pathname.startsWith('/candidates/')
    || pathname === '/uploader'
    || pathname === '/create-analysis'
    || pathname === '/account/payment-method'
}

