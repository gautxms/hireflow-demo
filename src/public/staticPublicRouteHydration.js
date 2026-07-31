import { getPublicRoute } from '../config/publicRouteManifest.js'

export function shouldHydrateStaticPublicRoute({ hasPrerenderedPublicMarkup, pathname }) {
  if (!hasPrerenderedPublicMarkup) {
    return false
  }

  return getPublicRoute(pathname)?.staticGeneration === true
}
