import { renderToString } from 'react-dom/server'
import PublicRouteApp from './public/PublicRouteApp'
import { STATIC_PUBLIC_ROUTES } from './config/publicRouteManifest'

export const staticPublicRoutes = STATIC_PUBLIC_ROUTES.map((route) => route.path)

export function renderPublicRoute(pathname) {
  if (!staticPublicRoutes.includes(pathname)) {
    throw new Error(`Unknown static public route: ${pathname}`)
  }

  return renderToString(<PublicRouteApp pathname={pathname} />)
}
