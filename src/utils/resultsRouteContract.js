/**
 * Results route contract:
 * - `/results` is the authenticated "my latest analysis" surface.
 * - `/results/:token` is the public shared-results surface.
 * - uploader -> results transitions should preserve user-visible empty-state copy.
 */
export const RESULTS_ROUTE_PATH = '/results'
export const RESULTS_ROUTE_PATTERN = /^\/results\/([^/]+)$/

export const RESULTS_EMPTY_STATE_COPY = Object.freeze({
  title: 'No recent analysis found',
  description: 'We couldn’t find a recent resume analysis for your account. Upload resumes to start a new analysis.',
  action: 'Go to uploader',
})

export function isResultsRootPath(pathname = '') {
  return String(pathname || '').trim() === RESULTS_ROUTE_PATH
}

export function getSharedResultsToken(pathname = '') {
  const match = String(pathname || '').match(RESULTS_ROUTE_PATTERN)
  if (!match) {
    return ''
  }

  return decodeURIComponent(match[1])
}

export function isSharedResultsPath(pathname = '') {
  return Boolean(getSharedResultsToken(pathname))
}
