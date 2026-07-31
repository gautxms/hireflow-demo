export const ROUTE_ACCESS = Object.freeze({
  PUBLIC: 'public',
  PROTECTED: 'protected',
})

export const PROTECTED_ROUTE_EXACT_PATHS = Object.freeze([
  '/dashboard',
  '/uploader',
  '/create-analysis',
  '/reports',
  '/shortlists',
  '/jobs',
  '/results',
  '/billing',
  '/checkout',
  '/account',
  '/settings',
  '/job-descriptions',
  '/analyses',
  '/candidates',
  '/admin',
])

export const PROTECTED_ROUTE_FAMILY_PREFIXES = Object.freeze([
  '/account',
  '/admin',
  '/billing',
  '/results',
  '/analyses',
  '/candidates',
  '/dashboard',
])

function normalizePathname(pathname) {
  const rawPath = String(pathname || '/').split(/[?#]/, 1)[0] || '/'
  if (rawPath === '/') return '/'
  return rawPath.replace(/\/+$/, '') || '/'
}

export function isProtectedRoutePath(pathname) {
  const normalized = normalizePathname(pathname)
  return PROTECTED_ROUTE_EXACT_PATHS.includes(normalized)
    || PROTECTED_ROUTE_FAMILY_PREFIXES.some((prefix) => normalized.startsWith(`${prefix}/`))
}

export function validatePublicRouteManifest(manifest) {
  if (!Array.isArray(manifest)) {
    throw new Error('Public route manifest must be an array.')
  }

  const seenPaths = new Set()
  for (const route of manifest) {
    const path = normalizePathname(route?.path)

    if (!route?.path || path !== route.path) {
      throw new Error(`Public route path must be canonical: ${route?.path || '<missing>'}`)
    }
    if (seenPaths.has(path)) {
      throw new Error(`Duplicate public route classification: ${path}`)
    }
    seenPaths.add(path)

    if (route.access !== ROUTE_ACCESS.PUBLIC) {
      throw new Error(`Contradictory route classification for ${path}: expected public access.`)
    }
    if ((route.staticGeneration || route.indexable) && isProtectedRoutePath(path)) {
      throw new Error(`Protected route cannot be statically generated or indexed: ${path}`)
    }
  }

  const duplicateProtectedPaths = PROTECTED_ROUTE_EXACT_PATHS.filter(
    (path, index) => PROTECTED_ROUTE_EXACT_PATHS.indexOf(path) !== index,
  )
  const duplicateProtectedFamilies = PROTECTED_ROUTE_FAMILY_PREFIXES.filter(
    (path, index) => PROTECTED_ROUTE_FAMILY_PREFIXES.indexOf(path) !== index,
  )
  if (duplicateProtectedPaths.length || duplicateProtectedFamilies.length) {
    throw new Error('Protected route classifications must be unique.')
  }

  return true
}
