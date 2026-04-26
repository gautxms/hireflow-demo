import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'

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
  return String(status || 'pending').toLowerCase()
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

  return (
    <main className="route-state">
      <section className="route-state-card">
        <a href="/analyses">← Back to analyses</a>
        <h1>Analysis {analysisId || '—'}</h1>

        {loading && <p>Loading analysis…</p>}
        {!loading && error && <p role="alert">{error}</p>}

        {!loading && !error && analysis && (
          <>
            <p>
              Live status: <strong>{normalizeStatus(analysis.liveStatus || analysis.status)}</strong>
            </p>
            <p>
              Created: {formatDate(analysis.createdAt)} · Completed: {formatDate(analysis.completedAt)}
            </p>
            <p>
              Summary — Total {summary.total || 0} · Complete {summary.complete || 0} · Failed {summary.failed || 0} · Processing {summary.processing || 0} · Pending {summary.pending || 0}
            </p>

            <table>
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
          </>
        )}
      </section>
    </main>
  )
}
