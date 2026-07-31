import { ROUTE_ACCESS, validatePublicRouteManifest } from './routeClassification.js'

export const PUBLIC_ROUTE_MANIFEST = Object.freeze([
  { path: '/', componentKey: 'landing', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/pricing', componentKey: 'pricing', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/about', componentKey: 'about', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/contact', componentKey: 'contact', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/help', componentKey: 'help', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/demo', componentKey: 'demo', access: ROUTE_ACCESS.PUBLIC, indexable: false, staticGeneration: false },
  { path: '/terms', componentKey: 'terms', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/privacy', componentKey: 'privacy', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/ai-disclosure', componentKey: 'aiDisclosure', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/trust', componentKey: 'trust', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/cookie-policy', componentKey: 'cookiePolicy', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/refund-policy', componentKey: 'refundPolicy', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/ai-resume-screening', componentKey: 'intent', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/bulk-resume-analysis', componentKey: 'intent', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/resume-scoring-ai', componentKey: 'intent', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
  { path: '/automated-candidate-shortlisting', componentKey: 'intent', access: ROUTE_ACCESS.PUBLIC, indexable: true, staticGeneration: true },
])

validatePublicRouteManifest(PUBLIC_ROUTE_MANIFEST)

export const PUBLIC_ROUTE_PATHS = new Set(PUBLIC_ROUTE_MANIFEST.map((route) => route.path))
export const STATIC_PUBLIC_ROUTES = Object.freeze(PUBLIC_ROUTE_MANIFEST.filter((route) => route.staticGeneration))
export const INDEXABLE_PUBLIC_ROUTES = Object.freeze(PUBLIC_ROUTE_MANIFEST.filter((route) => route.indexable))

export function normalizePublicPathname(pathname) {
  const rawPath = String(pathname || '/').split(/[?#]/, 1)[0] || '/'
  if (rawPath === '/') return '/'
  return rawPath.replace(/\/+$/, '') || '/'
}

export function getPublicRoute(pathname) {
  return PUBLIC_ROUTE_MANIFEST.find((route) => route.path === normalizePublicPathname(pathname)) || null
}
