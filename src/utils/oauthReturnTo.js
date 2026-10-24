export function getSafeOAuthReturnTo(locationLike = window.location) {
  const returnTo = new URLSearchParams(locationLike.search || '').get('returnTo')
  if (!returnTo) return ''

  try {
    const target = new URL(returnTo, locationLike.origin)
    if (target.origin !== locationLike.origin || target.pathname !== '/oauth/authorize') return ''
    return `${target.pathname}${target.search}`
  } catch {
    return ''
  }
}
