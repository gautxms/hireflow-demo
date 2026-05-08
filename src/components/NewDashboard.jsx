import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import { Icon } from './Icon'
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

function buildChartBars(series, key) {
  if (!series.length) return []
  const values = series.map((item) => Number(item[key] || 0))
  const max = Math.max(...values, 1)

  return values.map((value, index) => ({
    id: `${key}-${series[index]?.periodStart ?? index}`,
    height: Math.max((value / max) * 100, 8),
    value,
    label: formatDateLabel(series[index]?.periodStart),
  }))
}

export default function NewDashboard({ onNavigate }) {
  const [rangeDays, setRangeDays] = useState('30')
  const [jobDescriptionId, setJobDescriptionId] = useState('')
  const [dashboardData, setDashboardData] = useState(null)
  const [fetchState, setFetchState] = useState('idle')
  const [error, setError] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState('')
  const loading = fetchState === 'loading'
  const hasFetchError = fetchState === 'error'

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      setFetchState('loading')
      setError('')
      const params = new URLSearchParams({ rangeDays })
      if (jobDescriptionId) params.set('jobDescriptionId', jobDescriptionId)

      const response = await fetch(`${API_BASE}/profile/dashboard/kpis?${params.toString()}`, {
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message || payload.error || 'Unable to load dashboard')
      }
      setDashboardData(payload)
      setFetchState('success')
    } catch (fetchError) {
      setDashboardData(null)
      setError(fetchError.message || 'Unable to load dashboard')
      setFetchState('error')
    } finally {
      // no-op; fetchState tracks loading lifecycle
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
  const isEmpty = fetchState === 'success' && series.length === 0
  const analysesBars = useMemo(() => buildChartBars(series, 'analysesRunCount'), [series])
  const averageScoreBars = useMemo(() => buildChartBars(series, 'avgScore'), [series])

  return (
    <div className="new-dashboard">
      <div className="new-dashboard__header">
        <div className="new-dashboard__title-row">
          <h1 className="new-dashboard__title">Recruiting Dashboard</h1>
          <span className="new-dashboard__title-icon" aria-hidden="true"><Icon name="chart" size="lg" tone="accent" /></span>
        </div>
        <p className="new-dashboard__subtitle">KPI snapshots, trend lines, and exportable reports for hiring operations.</p>
      </div>

      <section className="new-dashboard__panel">
        <div className="new-dashboard__filters">
          <label className="new-dashboard__field">
            <span className="new-dashboard__field-label">Date range</span>
            <select value={rangeDays} onChange={(event) => setRangeDays(event.target.value)} className="new-dashboard__select">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          <label className="new-dashboard__field new-dashboard__field--wide">
            <span className="new-dashboard__field-label">Job</span>
            <select value={jobDescriptionId} onChange={(event) => setJobDescriptionId(event.target.value)} className="new-dashboard__select">
              <option value="">All jobs</option>
              {(dashboardData?.jobOptions || []).map((job) => (
                <option key={job.id} value={job.id}>{job.title}</option>
              ))}
            </select>
          </label>
          <div className="new-dashboard__actions">
            <button type="button" onClick={loadDashboard} disabled={loading} className="new-dashboard__button new-dashboard__button--primary">{loading ? 'Refreshing…' : 'Apply filters'}</button>
            <button type="button" onClick={exportCsv} disabled={exportLoading || loading} className="new-dashboard__button new-dashboard__button--secondary">{exportLoading ? 'Exporting…' : 'Export CSV'}</button>
          </div>
        </div>
        <div className="new-dashboard__meta-row">
          <p className="new-dashboard__report-period">Report period: {reportPeriod}</p>
          {hasFetchError ? <p className="new-dashboard__status new-dashboard__status--error">{error}</p> : null}
          {exportError ? <p className="new-dashboard__status">{exportError}</p> : null}
        </div>
      </section>

      <section className="new-dashboard__kpis">
        {[
          ['Analyses Run', kpis.analysesRunCount, 'file'],
          ['Completion Rate', formatPercent(kpis.completionRate), 'target'],
          ['Average Score', Number(kpis.avgScore || 0).toFixed(2), 'chart'],
          ['Shortlisted Rate', formatPercent(kpis.shortlistedRate), 'users'],
        ].map(([label, value, iconName]) => (
          <article key={label} className="new-dashboard__kpi-card kpi-card">
            <div className="new-dashboard__kpi-top-row">
              <p className="new-dashboard__kpi-label kpi-card-label">{label}</p>
              <span className="new-dashboard__kpi-icon" aria-hidden="true"><Icon name={iconName} size="sm" tone="muted" /></span>
            </div>
            <p className="new-dashboard__kpi-value kpi-card-value">{value}</p>
          </article>
        ))}
      </section>

      <section className="new-dashboard__trends">
        <article className="new-dashboard__trend-card">
          <h3 className="new-dashboard__trend-title"><Icon name="chart" size="sm" tone="muted" className="new-dashboard__trend-title-icon" />Analyses trend</h3>
          {loading ? <p className="new-dashboard__muted">Loading trend data…</p> : null}
          {hasFetchError ? <p className="new-dashboard__empty-state">Trend unavailable due to API error.</p> : null}
          {isEmpty ? <p className="new-dashboard__empty-state">No chart data for selected filters.</p> : null}
          {series.length > 0 && (
            <div className="new-dashboard__chart" role="img" aria-label="Analyses trend chart">
              {analysesBars.map((bar) => (
                <div key={bar.id} className="new-dashboard__bar-column">
                  <div className="new-dashboard__bar new-dashboard__bar--primary" style={{ height: `${bar.height}%` }} title={`${bar.label}: ${bar.value}`} />
                </div>
              ))}
            </div>
          )}
          <div className="new-dashboard__trend-range">
            <span>{series[0] ? formatDateLabel(series[0].periodStart) : '-'}</span>
            <span>{series.at(-1) ? formatDateLabel(series.at(-1).periodStart) : '-'}</span>
          </div>
        </article>

        <article className="new-dashboard__trend-card">
          <h3 className="new-dashboard__trend-title"><Icon name="target" size="sm" tone="muted" className="new-dashboard__trend-title-icon" />Average score trend</h3>
          {loading ? <p className="new-dashboard__muted">Loading trend data…</p> : null}
          {hasFetchError ? <p className="new-dashboard__empty-state">Trend unavailable due to API error.</p> : null}
          {isEmpty ? <p className="new-dashboard__empty-state">No chart data for selected filters.</p> : null}
          {series.length > 0 && (
            <div className="new-dashboard__chart" role="img" aria-label="Average score trend chart">
              {averageScoreBars.map((bar) => (
                <div key={bar.id} className="new-dashboard__bar-column">
                  <div className="new-dashboard__bar new-dashboard__bar--secondary" style={{ height: `${bar.height}%` }} title={`${bar.label}: ${bar.value.toFixed(2)}`} />
                </div>
              ))}
            </div>
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
