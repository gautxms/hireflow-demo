export function shouldVerifyAdminSessionOnVisibility({ visibilityState, pathname }) {
  return visibilityState === 'visible' && String(pathname || '').startsWith('/admin')
}
