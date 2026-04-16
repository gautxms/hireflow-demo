export const ADMIN_SECTIONS = [
  { key: 'summary', label: 'Summary', icon: '🏠', href: '/admin' },
  { key: 'overview', label: 'Overview', icon: '🗺️', href: '/admin/overview' },
  { key: 'users', label: 'Users', icon: '👥', href: '/admin/users' },
  { key: 'billing', label: 'Billing', icon: '💳', href: '/admin/billing' },
  { key: 'uploads', label: 'Uploads', icon: '📤', href: '/admin/uploads' },
  { key: 'analytics', label: 'Analytics', icon: '📊', href: '/admin/analytics' },
  { key: 'logs', label: 'Logs', icon: '📜', href: '/admin/logs' },
  { key: 'health', label: 'Health', icon: '🩺', href: '/admin/health' },
  { key: 'security', label: 'Security', icon: '🔐', href: '/admin/security' },
]

export function navigateAdmin(pathname) {
  const nextUrl = new URL(pathname, window.location.origin)
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const target = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`

  if (current !== target) {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}
