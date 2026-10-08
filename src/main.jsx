import React from 'react'
import ReactDOM, { hydrateRoot } from 'react-dom/client'
import './styles/variables.css'
import './styles/fonts.css'
import './styles/public-content-pages.css'
import './styles/ui-primitives.css'
import './styles/account-settings.css'
import './globals.css'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import API_BASE from './config/api'
import { shouldHydrateStaticPublicRoute } from './public/staticPublicRouteHydration.js'

const RECENT_CRASH_CONTEXT_KEY = 'hireflow_recent_crash_context_v1'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function storeCrashContext(detail) {
  try {
    localStorage.setItem(RECENT_CRASH_CONTEXT_KEY, JSON.stringify(detail))
  } catch {
    // Ignore storage failure.
  }
}

window.addEventListener('error', (event) => {
  const detail = {
    type: 'window.error',
    message: event?.message || 'Unhandled error',
    filename: event?.filename || '',
    lineno: event?.lineno || null,
    colno: event?.colno || null,
    stack: event?.error?.stack || '',
    timestamp: new Date().toISOString(),
  }
  storeCrashContext(detail)
  console.error('[HireFlow] window error', detail)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason
  const detail = {
    type: 'window.unhandledrejection',
    message: reason?.message || String(reason || 'Unhandled promise rejection'),
    stack: reason?.stack || '',
    timestamp: new Date().toISOString(),
  }
  storeCrashContext(detail)
  console.error('[HireFlow] unhandled rejection', detail)
})

window.addEventListener('hireflow:telemetry', (event) => {
  const payload = event?.detail
  if (!payload || typeof payload !== 'object') return

  const endpoint = `${API_BASE}/telemetry/client`

  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.warn('[HireFlow] Failed to persist telemetry event', {
      endpoint,
      eventType: payload?.eventType || 'unknown',
      message: error?.message || String(error),
    })
  })
})

function hasStoredAuthenticatedSession() {
  try {
    return Boolean(localStorage.getItem(TOKEN_STORAGE_KEY))
  } catch {
    return false
  }
}

const root = document.getElementById('root')
const shouldHydratePrerenderedRoute = shouldHydrateStaticPublicRoute({
  hasPrerenderedPublicMarkup: root.hasAttribute('data-static-public-route'),
  pathname: window.location.pathname,
})

if (shouldHydratePrerenderedRoute && !hasStoredAuthenticatedSession()) {
  import('./public/PublicRouteApp.jsx').then(({ default: PublicRouteApp }) => {
    hydrateRoot(
      root,
      <React.StrictMode>
        <AppErrorBoundary>
          <PublicRouteApp pathname={window.location.pathname} />
        </AppErrorBoundary>
      </React.StrictMode>,
    )
  })
} else {
  if (shouldHydratePrerenderedRoute) {
    root.replaceChildren()
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  )
}
