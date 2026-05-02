import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import './NewDashboard.css'

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
    <div className="new-dashboard">
      <div className="new-dashboard__header">
        <div>
          <h1 className="new-dashboard__title">Recruiting Dashboard</h1>
          <p className="new-dashboard__subtitle">KPI snapshots, trend lines, and exportable reports for hiring operations.</p>
        </div>
        <div className="new-dashboard__header-actions">
        </div>
      </div>

      <section className="new-dashboard__panel">
        <div className="new-dashboard__filters">
          <label>
            Date range
            <select value={rangeDays} onChange={(event) => setRangeDays(event.target.value)} className="new-dashboard__select">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          <label>
            Job
            <select value={jobDescriptionId} onChange={(event) => setJobDescriptionId(event.target.value)} className="new-dashboard__select new-dashboard__select--job">
              <option value="">All jobs</option>
              {(dashboardData?.jobOptions || []).map((job) => (
                <option key={job.id} value={job.id}>{job.title}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={loadDashboard} disabled={loading} className="new-dashboard__button">{loading ? 'Refreshing…' : 'Apply filters'}</button>
          <button type="button" onClick={exportCsv} disabled={exportLoading || loading} className="new-dashboard__button">{exportLoading ? 'Exporting…' : 'Export CSV'}</button>
        </div>
        <p className="new-dashboard__report-period">Report period: {reportPeriod}</p>
        {error ? <p className="new-dashboard__error">{error}</p> : null}
        {exportError ? <p className="new-dashboard__error">{exportError}</p> : null}
      </section>

      <section className="new-dashboard__kpis">
        {[
          ['Analyses Run', kpis.analysesRunCount],
          ['Completion Rate', formatPercent(kpis.completionRate)],
          ['Average Score', Number(kpis.avgScore || 0).toFixed(2)],
          ['Shortlisted Rate', formatPercent(kpis.shortlistedRate)],
        ].map(([label, value]) => (
          <article key={label} className="new-dashboard__kpi-card">
            <p className="new-dashboard__kpi-label">{label}</p>
            <p className="new-dashboard__kpi-value">{value}</p>
          </article>
        ))}
      </section>

      <section className="new-dashboard__trends">
        <article className="new-dashboard__trend-card">
          <h3 className="new-dashboard__trend-title">Analyses trend</h3>
          {loading ? <p>Loading trend data…</p> : null}
          {!loading && series.length === 0 ? <p className="new-dashboard__muted">No chart data for selected filters.</p> : null}
          {series.length > 0 && (
            <svg viewBox="0 0 100 100" className="new-dashboard__chart">
              <polyline fill="none" stroke="var(--color-accent-green)" strokeWidth="2" points={buildPolyline(series, 'analysesRunCount')} />
            </svg>
          )}
          <div className="new-dashboard__trend-range">
            <span>{series[0] ? formatDateLabel(series[0].periodStart) : '-'}</span>
            <span>{series.at(-1) ? formatDateLabel(series.at(-1).periodStart) : '-'}</span>
          </div>
        </article>

        <article className="new-dashboard__trend-card">
          <h3 className="new-dashboard__trend-title">Average score trend</h3>
          {loading ? <p>Loading trend data…</p> : null}
          {!loading && series.length === 0 ? <p className="new-dashboard__muted">No chart data for selected filters.</p> : null}
          {series.length > 0 && (
            <svg viewBox="0 0 100 100" className="new-dashboard__chart">
              <polyline fill="none" stroke="var(--color-accent-green-hover)" strokeWidth="2" points={buildPolyline(series, 'avgScore')} />
            </svg>
          )}
          <div className="new-dashboard__trend-range">
            <span>{series[0] ? formatDateLabel(series[0].periodStart) : '-'}</span>
            <span>{series.at(-1) ? formatDateLabel(series.at(-1).periodStart) : '-'}</span>
          </div>
        </article>
      </section>
    </div>
  )
}
