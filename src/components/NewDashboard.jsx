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

function formatScore(value) {
  return Number(value || 0).toFixed(2)
}

function buildAxisTicks(min, max, count = 4) {
  const safeMin = Number.isFinite(min) ? min : 0
  const safeMax = Number.isFinite(max) ? max : 0
  const hasRange = safeMax > safeMin
  const step = hasRange ? (safeMax - safeMin) / count : 1
  return Array.from({ length: count + 1 }, (_, index) => {
    const raw = hasRange ? safeMin + step * (count - index) : count - index
    return Number(raw)
  })
}

function getIntermediateDateTicks(series, tickCount = 4) {
  if (series.length <= 2) return series.map((item) => formatDateLabel(item.periodStart))
  const indices = new Set([0, series.length - 1])
  const step = (series.length - 1) / tickCount
  for (let i = 1; i < tickCount; i += 1) indices.add(Math.round(i * step))
  return [...indices].sort((a, b) => a - b).map((index) => formatDateLabel(series[index]?.periodStart))
}

function buildChartBars(series, key) {
  if (!series.length) return []
  const normalized = series.map((item) => {
    const rawValue = item?.[key]
    const hasData = rawValue !== null && rawValue !== undefined
    const value = hasData ? Number(rawValue) : 0
    return { hasData, value: Number.isFinite(value) ? value : 0 }
  })
  const valuesWithData = normalized.filter((item) => item.hasData).map((item) => item.value)
  const max = Math.max(...valuesWithData, 1)

  return normalized.map((item, index) => ({
    id: `${key}-${series[index]?.periodStart ?? index}`,
    height: item.hasData ? Math.max((item.value / max) * 100, 8) : 12,
    value: item.value,
    hasData: item.hasData,
    label: formatDateLabel(series[index]?.periodStart),
  }))
}

function buildLineSegments(series) {
  const segments = []
  let current = []
  const denominator = Math.max(series.length - 1, 1)

  series.forEach((point, index) => {
    if (!point.hasData) {
      if (current.length > 1) segments.push(current)
      current = []
      return
    }
    current.push(`${(index / denominator) * 100},${100 - point.height}`)
  })

  if (current.length > 1) segments.push(current)
  return segments
}

export default function NewDashboard() {
  const [rangeDays, setRangeDays] = useState('30')
  const [jobDescriptionId, setJobDescriptionId] = useState('')
  const [dashboardData, setDashboardData] = useState(null)
  const [fetchState, setFetchState] = useState('idle')
  const [error, setError] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportSuccess, setExportSuccess] = useState('')
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
      setExportSuccess('')
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
      setExportSuccess('CSV exported successfully for the active filters.')
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

  const analysesTrend = useMemo(() => dashboardData?.charts?.analysesTrend || [], [dashboardData])
  const averageScoreTrend = useMemo(() => dashboardData?.charts?.averageScoreTrend || [], [dashboardData])
  const hasScoreData = Boolean(dashboardData?.flags?.hasScoreData)
  const isAnalysesEmpty = fetchState === 'success' && analysesTrend.length === 0
  const isScoreEmpty = fetchState === 'success' && averageScoreTrend.length === 0
  const analysesBars = useMemo(() => buildChartBars(analysesTrend, 'value'), [analysesTrend])
  const averageScoreBars = useMemo(() => buildChartBars(averageScoreTrend, 'value'), [averageScoreTrend])
  const analysesMax = useMemo(() => Math.max(...analysesTrend.map((item) => Number(item.value || 0)), 1), [analysesTrend])
  const analysesTicks = useMemo(() => buildAxisTicks(0, analysesMax, 4).map((value) => Math.round(value)), [analysesMax])
  const analysesDateTicks = useMemo(() => getIntermediateDateTicks(analysesTrend), [analysesTrend])
  const scoreValues = useMemo(() => averageScoreTrend.map((item) => Number(item.value || 0)), [averageScoreTrend])
  const scoreMin = useMemo(() => Math.min(...scoreValues, 0), [scoreValues])
  const scoreMax = useMemo(() => Math.max(...scoreValues, 1), [scoreValues])
  const scoreTicks = useMemo(() => buildAxisTicks(scoreMin, scoreMax, 4).map((value) => Number(value.toFixed(2))), [scoreMin, scoreMax])
  const scoreDateTicks = useMemo(() => getIntermediateDateTicks(averageScoreTrend), [averageScoreTrend])

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
          <div className="new-dashboard__control-group" role="group" aria-label="Dashboard filters">
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
          </div>
          <div className="new-dashboard__actions" role="group" aria-label="Dashboard actions">
            <button type="button" onClick={loadDashboard} disabled={loading} className="new-dashboard__button hf-btn hf-btn--primary new-dashboard__button--primary">{loading ? 'Refreshing…' : 'Apply filters'}</button>
            <button type="button" onClick={exportCsv} disabled={exportLoading || loading} className="new-dashboard__button hf-btn hf-btn--secondary new-dashboard__button--secondary">{exportLoading ? 'Exporting…' : 'Export CSV'}</button>
          </div>
        </div>
        <div className="new-dashboard__meta-row">
          <p className="new-dashboard__report-period">Report period: {reportPeriod}</p>
          {hasFetchError ? <p className="new-dashboard__status new-dashboard__status--error">{error}</p> : null}
          {exportError ? <p className="new-dashboard__status">{exportError}</p> : null}
          {exportSuccess ? <p className="new-dashboard__status">{exportSuccess}</p> : null}
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
        <article className="new-dashboard__trend-card" role="region" aria-labelledby="dashboard-analyses-trend-title">
          <h3 id="dashboard-analyses-trend-title" className="new-dashboard__trend-title"><Icon name="chart" size="sm" tone="muted" className="new-dashboard__trend-title-icon" />Analyses trend</h3>
          {loading ? <p className="new-dashboard__muted">Loading trend data…</p> : null}
          {hasFetchError ? <p className="new-dashboard__empty-state">Trend unavailable due to API error.</p> : null}
          {isAnalysesEmpty ? <p className="new-dashboard__empty-state">No chart data for selected filters.</p> : null}
          {analysesTrend.length > 0 && (
            <div className="new-dashboard__chart-shell">
              <div className="new-dashboard__y-axis" aria-hidden="true">
                {analysesTicks.map((tick) => <span key={`analyses-tick-${tick}`}>{tick}</span>)}
              </div>
              <div className="new-dashboard__chart" aria-label="Analyses trend bar chart with count axis and date ticks">
              {analysesBars.map((bar) => (
                <button key={bar.id} type="button" className="new-dashboard__bar-column" aria-label={bar.hasData ? `${bar.label}: ${bar.value} analyses` : `${bar.label}: no data for this period`} data-tooltip={bar.hasData ? `${bar.label}: ${bar.value} analyses` : `${bar.label}: No data`} data-state={bar.hasData ? 'value' : 'missing'}>
                  <div className={`new-dashboard__bar ${bar.hasData ? 'new-dashboard__bar--primary' : 'new-dashboard__bar--missing'}`} style={{ height: `${bar.height}%` }} />
                </button>
              ))}
              </div>
            </div>
          )}
          <div className="new-dashboard__x-axis" aria-hidden="true">
            {analysesDateTicks.map((label) => <span key={`analyses-date-${label}`}>{label}</span>)}
          </div>
        </article>

        <article className="new-dashboard__trend-card" role="region" aria-labelledby="dashboard-average-score-trend-title">
          <h3 id="dashboard-average-score-trend-title" className="new-dashboard__trend-title"><Icon name="target" size="sm" tone="muted" className="new-dashboard__trend-title-icon" />Average score trend</h3>
          {loading ? <p className="new-dashboard__muted">Loading trend data…</p> : null}
          {hasFetchError ? <p className="new-dashboard__empty-state">Trend unavailable due to API error.</p> : null}
          {!hasScoreData && !loading && !hasFetchError ? <p className="new-dashboard__empty-state">No score data available for selected filters.</p> : null}
          {isScoreEmpty ? <p className="new-dashboard__empty-state">No chart data for selected filters.</p> : null}
          {averageScoreTrend.length > 0 && hasScoreData && (
            <div className="new-dashboard__chart-shell">
              <div className="new-dashboard__y-axis" aria-hidden="true">
                {scoreTicks.map((tick) => <span key={`score-tick-${tick}`}>{formatScore(tick)}</span>)}
              </div>
              <div className="new-dashboard__chart new-dashboard__chart--line" aria-label="Average score trend line chart with score axis and date ticks">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="new-dashboard__line-svg" aria-hidden="true">
                  {buildLineSegments(averageScoreBars).map((segment) => (
                    <polyline
                      key={segment.join('-')}
                      fill="none"
                      stroke="var(--color-accent-green-hover)"
                      strokeWidth="2.5"
                      points={segment.join(' ')}
                    />
                  ))}
                </svg>
                {averageScoreBars.map((bar, index) => (
                  <button
                    key={bar.id}
                    type="button"
                    className="new-dashboard__point"
                    style={{ left: `${(index / Math.max(averageScoreBars.length - 1, 1)) * 100}%`, bottom: `${bar.height}%` }}
                    aria-label={bar.hasData ? `${bar.label}: ${formatScore(bar.value)} score` : `${bar.label}: no score data for this period`}
                    data-tooltip={bar.hasData ? `${bar.label}: ${formatScore(bar.value)} score` : `${bar.label}: No score data`}
                    data-state={bar.hasData ? 'value' : 'missing'}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="new-dashboard__x-axis" aria-hidden="true">
            {scoreDateTicks.map((label) => <span key={`score-date-${label}`}>{label}</span>)}
          </div>
        </article>
      </section>
    </div>
  )
}
