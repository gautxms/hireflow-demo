import React, { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import CandidateResults from '../components/CandidateResults'
import '../styles/analyses.css'
import { logResultsRenderError } from './resultsErrorBoundaryTelemetry'
import { toCandidateResultsPayload } from './analysisDetailPayload.js'
import { validateAnalysisResultsPayload } from '../schemas/analysisResultsSchema.js'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const POLL_MS = 2500
const isNonProductionBuild = (() => {
  if (typeof process !== 'undefined' && process?.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location?.hostname)
})()

function normalizeStatus(status) {
  const normalizedStatus = String(status || 'pending').trim().toLowerCase()
  const STATUS_ALIAS_MAP = {
    queued: 'pending',
    retrying: 'processing',
  }
  return STATUS_ALIAS_MAP[normalizedStatus] || normalizedStatus
}

function deriveDisplayStatus(analysis) {
  const summary = analysis?.summary || {}
  const total = Number(summary.total || 0)
  const complete = Number(summary.complete || 0)
  const failed = Number(summary.failed || 0)
  const processing = Number(summary.processing || 0)
  const pending = Number(summary.pending || 0)

  if (complete > 0 && failed > 0) return 'partial'
  if (total > 0 && complete === total && failed === 0) return 'complete'
  if (total > 0 && failed === total) return 'failed'
  if (processing > 0) return 'processing'
  if (pending > 0) return 'pending'

  return normalizeStatus(analysis?.liveStatus || analysis?.status)
}


export class ResultsErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, diagnosticCode: '', diagnosticTimestamp: '' }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    const telemetryEvent = logResultsRenderError({
      analysisId: this.props.analysisId,
      candidateCount: this.props.candidateCount,
      normalizationStats: this.props.normalizationStats,
      error,
      errorInfo,
    })
    this.setState({ diagnosticCode: telemetryEvent.diagnosticCode, diagnosticTimestamp: telemetryEvent.timestamp })
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="route-state-card" role="alert">
          <p>We could not render these results. Please return to Analyses or retry.</p>
          <a href="/analyses">← Back to analyses</a>
          {import.meta.env?.DEV && this.state.diagnosticCode && this.state.diagnosticTimestamp && (
            <p data-testid="results-error-diagnostic">{this.state.diagnosticCode} · {this.state.diagnosticTimestamp}</p>
          )}
        </section>
      )
    }

    return this.props.children
  }
}

export default function AnalysisDetailPage({ pathname = '' }) {
  const analysisId = useMemo(() => {
    const parts = String(pathname || '').split('/').filter(Boolean)
    return parts.length >= 2 ? parts[1] : ''
  }, [pathname])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token || !analysisId) {
      setError('Invalid analysis session.')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let intervalId = null

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/analyses/${analysisId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load analysis details')
        }

        setAnalysis(payload)
        setError('')
      } catch (loadError) {
        if (loadError.name === 'AbortError') {
          return
        }
        setError(loadError.message || 'Unable to load analysis details')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    load()
    intervalId = window.setInterval(load, POLL_MS)

    return () => {
      controller.abort()
      if (intervalId) {
        window.clearInterval(intervalId)
      }
    }
  }, [analysisId])

  const summary = analysis?.summary || {}
  const displayStatus = deriveDisplayStatus(analysis)
  const candidateResultsPayload = useMemo(() => {
    const rawPayload = toCandidateResultsPayload(analysis)
    const { payload } = validateAnalysisResultsPayload(rawPayload)
    return payload
  }, [analysis])
  const itemCount = Array.isArray(analysis?.items) ? analysis.items.length : 0
  const candidateCount = candidateResultsPayload.candidates.length
  const failedCount = Number(summary.failed || 0)

  if (loading || error || !analysis) {
    return (
      <main className="route-state">
        <section className="route-state-card">
          <a href="/analyses">← Back to analyses</a>
          <h1>Analysis {analysisId || '—'}</h1>
          {loading && <p>Loading analysis…</p>}
          {!loading && error && <p role="alert">{error}</p>}
        </section>
      </main>
    )
  }

  if (
  (displayStatus === 'complete' ||
    displayStatus === 'completed' ||
    displayStatus === 'partial' ||
    displayStatus === 'failed') &&
  candidateResultsPayload.candidates.length > 0
) {
  return (
    <main className="analyses-layout">
      <section className="analyses-layout__content">
        <ResultsErrorBoundary
          analysisId={analysisId}
          candidateCount={candidateCount}
          normalizationStats={{
            inputCount: itemCount,
            droppedCount: Math.max(itemCount - candidateCount, 0),
          }}
        >
          {isNonProductionBuild && candidateResultsPayload.droppedCount > 0 && (
            <section className="route-state-card" role="status" aria-live="polite">
              <p>
                Dev warning: dropped {candidateResultsPayload.droppedCount} of {candidateResultsPayload.inputCount} incoming candidates during normalization.
                Inspect logs for analysisId {analysisId || '—'}.
              </p>
            </section>
          )}

          <CandidateResults
            candidates={candidateResultsPayload}
            onBack={() => {
              window.location.href = '/analyses'
            }}
          />
        </ResultsErrorBoundary>
      </section>
    </main>
  )
}

  return (
    <main className="route-state">
      <section className="route-state-card">
        <a href="/analyses">← Back to analyses</a>
        <h1>Analysis {analysisId || '—'}</h1>
        <p>Current status: <strong>{displayStatus}</strong></p>
        {displayStatus === 'failed' ? (
          <p role="alert">This analysis failed before results were finalized. Please re-run the analysis or check the source files.</p>
        ) : (
          <p>This analysis is still processing. Results will be available when processing completes.</p>
        )}
        <p>Summary — Total {summary.total || 0} · Complete {summary.complete || 0} · Failed {failedCount} · Processing {summary.processing || 0} · Pending {summary.pending || 0}</p>
      </section>
    </main>
  )
}
