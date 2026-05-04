import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import CandidateResults from '../components/CandidateResults'
import '../styles/analyses.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const POLL_MS = 2500

function formatDate(value) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return date.toLocaleString()
}

function normalizeStatus(status) {
  const normalizedStatus = String(status || 'pending').trim().toLowerCase()
  const STATUS_ALIAS_MAP = {
    queued: 'pending',
    retrying: 'processing',
  }
  return STATUS_ALIAS_MAP[normalizedStatus] || normalizedStatus
}

function toCandidateResultsPayload(analysis) {
  const items = Array.isArray(analysis?.items) ? analysis.items : []
  const completedEntries = items.flatMap((item) => {
    const result = item?.result || {}
    const candidates = Array.isArray(result?.candidates) ? result.candidates : []
    return candidates.map((candidate) => ({
      resumeId: item?.resumeId || candidate?.resumeId || candidate?.resume_id || '',
      filename: item?.filename || result?.filename || '',
      ...candidate,
    }))
  })

  return {
    candidates: completedEntries,
    parseMeta: {
      hasJobDescription: Boolean(analysis?.jobDescriptionId),
      methodUsed: 'ai-extraction',
    },
    jobStatuses: items.map((item) => ({
      jobId: String(item?.parseJobId || '').trim(),
      resumeId: String(item?.resumeId || '').trim(),
      filename: String(item?.filename || '').trim(),
      status: String(item?.status || 'processing').trim() || 'processing',
      progress: Number(item?.progress || 0),
      error: item?.error ? String(item.error) : '',
    })),
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

  const itemRows = Array.isArray(analysis?.items) ? analysis.items : []
  const summary = analysis?.summary || {}
  const liveStatus = normalizeStatus(analysis?.liveStatus || analysis?.status)
  const isCompletedTerminalState = liveStatus === 'complete' || liveStatus === 'completed'
  const candidateResultsPayload = useMemo(() => toCandidateResultsPayload(analysis), [analysis])
  const failedCount = Number(summary.failed || 0)
  const completeCount = Number(summary.complete || 0)
  const hasFailures = liveStatus === 'failed' || failedCount > 0
  const isComplete = (liveStatus === 'complete' || liveStatus === 'completed') && !hasFailures

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

  if (isCompletedTerminalState) {
    return (
      <main className="analyses-layout">
        <section className="analyses-layout__content">
          <CandidateResults
            candidates={candidateResultsPayload}
            onBack={() => {
              window.location.href = '/analyses'
            }}
          />
        </section>
      </main>
    )
  }

  return (
    <main className="analyses-layout">
      <section className="analyses-layout__content">
        <a href="/analyses">← Back to analyses</a>
        <h1>Analysis {analysisId || '—'}</h1>

        <>
          <p>
            Live status: <strong>{normalizeStatus(analysis.liveStatus || analysis.status)}</strong>
          </p>
          <p>
            Created: {formatDate(analysis.createdAt)} · Completed: {formatDate(analysis.completedAt)}
          </p>
          <p className="analysis-detail-page__summary">
            Summary — Total {summary.total || 0} · Complete {completeCount} · Failed {failedCount} · Processing {summary.processing || 0} · Pending {summary.pending || 0}
          </p>

          {hasFailures && (
            <section className="analysis-detail-page__status-note analysis-detail-page__status-note--failed" role="region" aria-label="Failure overview">
              <h2>Failure Overview</h2>
              <p>This analysis has terminal failures (or a mixed completion with failures). Review item-level errors for remediation details.</p>
              <p>Failed items: <strong>{failedCount}</strong></p>
            </section>
          )}

          {isComplete && (
            <section className="analysis-detail-page__status-note">
              <h2>Results Ready</h2>
              <p>This analysis completed without failures. Continue in the full results experience.</p>
              <p><a href="/results">Open perfect results experience →</a></p>
            </section>
          )}

          {(liveStatus === 'pending' || liveStatus === 'processing') && <p className="analysis-detail-page__status-note">This analysis is still running. Statuses refresh automatically every few seconds.</p>}

          <div className="analyses-layout__table-shell">
            <table className="analyses-layout__table">
            <thead>
              <tr>
                <th>Resume</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Updated</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {itemRows.map((item) => (
                <tr key={item.id}>
                  <td>{item.filename || item.resumeId || item.parseJobId}</td>
                  <td>{normalizeStatus(item.status)}</td>
                  <td>{Number(item.progress || 0)}%</td>
                  <td>{formatDate(item.updatedAt || item.createdAt)}</td>
                  <td>{item.error || '—'}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </>
      </section>
    </main>
  )
}
