import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

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

export default function AnalysesPage({ onCreateAnalysis }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) {
      setError('Authentication required.')
      setLoading(false)
      return
    }

    const controller = new AbortController()

    const load = async () => {
      try {
        setLoading(true)
        setError('')

        const response = await fetch(`${API_BASE}/analyses`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load analyses')
        }

        setItems(Array.isArray(payload.items) ? payload.items : [])
      } catch (loadError) {
        if (loadError.name === 'AbortError') {
          return
        }
        setError(loadError.message || 'Unable to load analyses')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    load()

    return () => controller.abort()
  }, [])

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [items],
  )

  return (
    <main className="route-state">
      <section className="route-state-card">
        <div className="analyses-page__header"><div><h1>Analyses</h1><p>Historical upload analyses and their latest live statuses.</p></div><button type="button" className="btn-primary" onClick={onCreateAnalysis}>Create analysis</button></div>

        {loading && <p>Loading analyses…</p>}
        {!loading && error && <p role="alert">{error}</p>}

        {!loading && !error && sortedItems.length === 0 && (
          <p>No analyses yet. Upload resumes to create your first run.</p>
        )}

        {!loading && !error && sortedItems.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Live status</th>
                <th>Summary</th>
                <th>Job description</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((analysis) => {
                const status = normalizeStatus(analysis.liveStatus || analysis.status)
                const summary = analysis.summary || {}
                return (
                  <tr key={analysis.id}>
                    <td>{formatDate(analysis.createdAt)}</td>
                    <td>{status}</td>
                    <td>
                      Total {summary.total || 0} · Complete {summary.complete || 0} · Failed {summary.failed || 0} · Pending {(summary.pending || 0) + (summary.processing || 0)}
                    </td>
                    <td>{analysis.jobDescriptionTitle || 'No job description'}</td>
                    <td><a href={`/analyses/${analysis.id}`}>View</a></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
