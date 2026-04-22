import React from 'react'
import { readResumeAnalysisSession } from './resumeAnalysisSession'
import { deriveBoundaryStateFromError } from './appErrorBoundaryState'

const RECENT_CRASH_CONTEXT_KEY = 'hireflow_recent_crash_context_v1'

function isDevelopment() {
  return import.meta.env?.DEV
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      resumeAvailable: false,
    }
  }

  static getDerivedStateFromError(error) {
    const session = readResumeAnalysisSession()
    return deriveBoundaryStateFromError(error, session)
  }

  componentDidCatch(error, info) {
    const crashContext = {
      type: 'react_error_boundary',
      message: error?.message || 'Unknown runtime error',
      stack: error?.stack || '',
      componentStack: info?.componentStack || '',
      timestamp: new Date().toISOString(),
    }

    window.dispatchEvent(new CustomEvent('hireflow:runtime-crash', { detail: crashContext }))

    try {
      localStorage.setItem(RECENT_CRASH_CONTEXT_KEY, JSON.stringify(crashContext))
    } catch {
      // no-op
    }

    console.error('[HireFlow] Runtime crash captured by AppErrorBoundary', crashContext)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReturnHome = () => {
    window.location.assign('/')
  }

  handleResume = () => {
    window.location.assign('/?resumeAnalysis=1')
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const dev = isDevelopment()

    return (
      <main className="route-state route-state--error" role="alert" aria-live="assertive">
        <section className="route-state-card">
          <p className="route-state-card__eyebrow">HireFlow recovery mode</p>
          <h1 className="route-state-card__title">Something went wrong</h1>
          <p className="route-state-card__description">
            Your session is safe. You can reload the app, return home, or resume your last analysis.
          </p>
          <div className="route-state-card__actions route-state-card__actions--recovery">
            <button type="button" className="route-state-card__action" onClick={this.handleReload}>Reload app</button>
            <button type="button" className="route-state-card__action" onClick={this.handleReturnHome}>Return to dashboard/home</button>
            {this.state.resumeAvailable && (
              <button type="button" className="route-state-card__action" onClick={this.handleResume}>Resume last analysis</button>
            )}
          </div>
          {dev && this.state.error && (
            <details className="resume-error-details route-state-card__details">
              <summary className="resume-error-details-summary">Development diagnostics</summary>
              <pre className="resume-error-details-pre">{this.state.error.stack || this.state.error.message}</pre>
            </details>
          )}
        </section>
      </main>
    )
  }
}
