export const ADMIN_SECTIONS = [
  { key: 'overview', label: 'Overview', icon: '🏠', href: '/admin/overview' },
  { key: 'users', label: 'Users', icon: '👥', href: '/admin/users' },
  { key: 'billing', label: 'Billing', icon: '💳', href: '/admin/billing' },
  { key: 'uploads', label: 'Uploads', icon: '📤', href: '/admin/uploads' },
  { key: 'analytics', label: 'Analytics', icon: '📊', href: '/admin/analytics' },
  { key: 'logs', label: 'Logs', icon: '📜', href: '/admin/logs' },
  { key: 'health', label: 'Health', icon: '🩺', href: '/admin/health' },
  { key: 'security', label: 'Security', icon: '🔐', href: '/admin/security' },
]

export function navigateAdmin(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}
