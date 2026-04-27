import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function toIsoDate(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function formatDateLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function buildPolyline(series, key) {
  if (!series.length) return ''
  const values = series.map((item) => Number(item[key] || 0))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const xStep = series.length > 1 ? 100 / (series.length - 1) : 100

  return series
    .map((item, index) => {
      const value = Number(item[key] || 0)
      const y = max === min ? 50 : 100 - ((value - min) / (max - min)) * 100
      return `${(index * xStep).toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

export default function NewDashboard({ onNavigate }) {
  const [rangeDays, setRangeDays] = useState('30')
  const [jobDescriptionId, setJobDescriptionId] = useState('')
  const [dashboardData, setDashboardData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState('')

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const params = new URLSearchParams({ rangeDays })
      if (jobDescriptionId) params.set('jobDescriptionId', jobDescriptionId)

      const response = await fetch(`${API_BASE}/profile/dashboard/kpis?${params.toString()}`, {
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load dashboard')
      }
      setDashboardData(payload)
    } catch (fetchError) {
      setDashboardData(null)
      setError(fetchError.message || 'Unable to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [authHeaders, jobDescriptionId, rangeDays])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const exportCsv = async () => {
    try {
      setExportLoading(true)
      setExportError('')
      const params = new URLSearchParams({ rangeDays, export: 'csv' })
      if (jobDescriptionId) params.set('jobDescriptionId', jobDescriptionId)

      const response = await fetch(`${API_BASE}/profile/dashboard/kpis?${params.toString()}`, {
        headers: authHeaders(),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Unable to export CSV')
      }

      const csvBlob = await response.blob()
      const url = URL.createObjectURL(csvBlob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `hireflow-dashboard-${Date.now()}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (csvError) {
      setExportError(csvError.message || 'Unable to export CSV')
    } finally {
      setExportLoading(false)
    }
  }

  const openLegacyDashboard = () => {
    window.history.pushState({}, '', '/dashboard/legacy')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const reportPeriod = dashboardData?.range
    ? `${dashboardData.range.startDate} → ${dashboardData.range.endDate}`
    : `${toIsoDate(new Date(Date.now() - 29 * 86400000))} → ${toIsoDate(new Date())}`

  const kpis = dashboardData?.kpis || {
    analysesRunCount: 0,
    completionRate: 0,
    avgScore: 0,
    shortlistedRate: 0,
  }

  const series = useMemo(() => dashboardData?.charts?.overview || [], [dashboardData])

  return (
    <div style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Recruiting Dashboard</h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>KPI snapshots, trend lines, and exportable reports for hiring operations.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={() => onNavigate?.('landing')} className="touch-target" style={{ padding: '0.6rem 0.9rem' }}>Home</button>
          <button type="button" onClick={openLegacyDashboard} className="touch-target" style={{ padding: '0.6rem 0.9rem' }}>Legacy dashboard fallback</button>
        </div>
      </div>

      <section style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
          <label>
            Date range
            <select value={rangeDays} onChange={(event) => setRangeDays(event.target.value)} style={{ display: 'block', marginTop: 4 }}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          <label>
            Job
            <select value={jobDescriptionId} onChange={(event) => setJobDescriptionId(event.target.value)} style={{ display: 'block', marginTop: 4, minWidth: 220 }}>
              <option value="">All jobs</option>
              {(dashboardData?.jobOptions || []).map((job) => (
                <option key={job.id} value={job.id}>{job.title}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={loadDashboard} disabled={loading} style={{ padding: '0.6rem 0.9rem' }}>{loading ? 'Refreshing…' : 'Apply filters'}</button>
          <button type="button" onClick={exportCsv} disabled={exportLoading || loading} style={{ padding: '0.6rem 0.9rem' }}>{exportLoading ? 'Exporting…' : 'Export CSV'}</button>
        </div>
        <p style={{ marginTop: '0.75rem', marginBottom: 0, color: 'var(--color-text-secondary)', fontSize: 13 }}>Report period: {reportPeriod}</p>
        {error ? <p style={{ color: 'var(--color-error)', marginTop: '0.5rem' }}>{error}</p> : null}
        {exportError ? <p style={{ color: 'var(--color-error)', marginTop: '0.5rem' }}>{exportError}</p> : null}
      </section>

      <section style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '1rem' }}>
        {[
          ['Analyses Run', kpis.analysesRunCount],
          ['Completion Rate', formatPercent(kpis.completionRate)],
          ['Average Score', Number(kpis.avgScore || 0).toFixed(2)],
          ['Shortlisted Rate', formatPercent(kpis.shortlistedRate)],
        ].map(([label, value]) => (
          <article key={label} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 13 }}>{label}</p>
            <p style={{ margin: '0.4rem 0 0', fontSize: 24, fontWeight: 700 }}>{value}</p>
          </article>
        ))}
      </section>

      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <article style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Analyses trend</h3>
          {loading ? <p>Loading trend data…</p> : null}
          {!loading && series.length === 0 ? <p style={{ color: 'var(--color-text-secondary)' }}>No chart data for selected filters.</p> : null}
          {series.length > 0 && (
            <svg viewBox="0 0 100 100" style={{ width: '100%', height: 180, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              <polyline fill="none" stroke="var(--color-accent-green)" strokeWidth="2" points={buildPolyline(series, 'analysesRunCount')} />
            </svg>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <span>{series[0] ? formatDateLabel(series[0].periodStart) : '-'}</span>
            <span>{series.at(-1) ? formatDateLabel(series.at(-1).periodStart) : '-'}</span>
          </div>
        </article>

        <article style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Average score trend</h3>
          {loading ? <p>Loading trend data…</p> : null}
          {!loading && series.length === 0 ? <p style={{ color: 'var(--color-text-secondary)' }}>No chart data for selected filters.</p> : null}
          {series.length > 0 && (
            <svg viewBox="0 0 100 100" style={{ width: '100%', height: 180, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              <polyline fill="none" stroke="var(--color-accent-green-hover)" strokeWidth="2" points={buildPolyline(series, 'avgScore')} />
            </svg>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <span>{series[0] ? formatDateLabel(series[0].periodStart) : '-'}</span>
            <span>{series.at(-1) ? formatDateLabel(series.at(-1).periodStart) : '-'}</span>
          </div>
        </article>
      </section>
    </div>
  )
}
