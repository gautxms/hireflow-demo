import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/variables.css'
import './globals.css'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary'

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
