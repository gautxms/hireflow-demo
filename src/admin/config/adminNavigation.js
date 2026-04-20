export const ADMIN_SECTIONS = [
  { key: 'overview', label: 'Overview', icon: 'home', href: '/admin/overview' },
  { key: 'users', label: 'Users', icon: 'users', href: '/admin/users' },
  { key: 'billing', label: 'Billing', icon: 'creditCard', href: '/admin/billing' },
  { key: 'uploads', label: 'Uploads', icon: 'upload', href: '/admin/uploads' },
  { key: 'analytics', label: 'Analytics', icon: 'chart', href: '/admin/analytics' },
  { key: 'logs', label: 'Logs', icon: 'logs', href: '/admin/logs' },
  { key: 'health', label: 'Health', icon: 'health', href: '/admin/health' },
  { key: 'security', label: 'Security', icon: 'lock', href: '/admin/security' },
]

export function navigateAdmin(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}
