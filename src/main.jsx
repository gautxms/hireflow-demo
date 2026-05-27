import React from 'react'
import ReactDOM from 'react-dom/client'
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

const RECENT_CRASH_CONTEXT_KEY = 'hireflow_recent_crash_context_v1'

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
