const CHUNK_RELOAD_GUARD_PREFIX = 'hireflow_chunk_reload_attempted'

function getBuildId() {
  return import.meta.env.VITE_BUILD_ID || import.meta.env.MODE || 'unknown'
}

function shouldHandleChunkLoadFailure(error) {
  const message = error?.message || ''
  return (
    error?.name === 'ChunkLoadError'
    || message.includes('Failed to fetch dynamically imported module')
    || message.includes('Loading chunk')
  )
}

function trackPublicRouteChunkLoadFailure({ route, retryAttempted, error }) {
  const payload = {
    event: 'public_route_chunk_load_failure',
    route,
    build_id: getBuildId(),
    user_agent: window.navigator.userAgent,
    retry_attempted: retryAttempted,
    error_name: error?.name || 'Error',
    error_message: error?.message || 'Unknown dynamic import failure',
    timestamp: new Date().toISOString(),
  }

  window.dispatchEvent(new CustomEvent('hireflow:telemetry', { detail: payload }))
  console.error('[HireFlow] public route chunk load failure', payload)
}

export function loadPublicRouteChunk(importer, { route }) {
  return importer().then((module) => {
    clearPublicRouteChunkReloadGuard(route)
    return module
  }).catch((error) => {
    if (!shouldHandleChunkLoadFailure(error)) {
      throw error
    }

    const reloadGuardKey = `${CHUNK_RELOAD_GUARD_PREFIX}:${getBuildId()}:${route}`
    const retryAttempted = sessionStorage.getItem(reloadGuardKey) === '1'

    trackPublicRouteChunkLoadFailure({ route, retryAttempted, error })

    if (!retryAttempted) {
      sessionStorage.setItem(reloadGuardKey, '1')
      window.location.reload()
      return new Promise(() => {})
    }

    throw error
  })
}

export function clearPublicRouteChunkReloadGuard(route) {
  const reloadGuardKey = `${CHUNK_RELOAD_GUARD_PREFIX}:${getBuildId()}:${route}`
  sessionStorage.removeItem(reloadGuardKey)
}
