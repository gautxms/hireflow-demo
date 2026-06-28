import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
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
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : '—'
}

function parseFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function formatCompactNumber(value) {
  const numericValue = Number(value || 0)
  return Number.isFinite(numericValue) ? numericValue.toLocaleString() : '0'
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
    const value = parseFiniteNumber(rawValue)
    const hasData = value !== null
    return { hasData, value: hasData ? value : null }
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

function buildScoreChartPoints(series, axisMin, axisMax) {
  if (!series.length) return []
  const safeMin = Number.isFinite(axisMin) ? axisMin : 0
  const safeMax = Number.isFinite(axisMax) && axisMax > safeMin ? axisMax : safeMin + 1
  const range = safeMax - safeMin
  const denominator = Math.max(series.length - 1, 1)

  return series.map((item, index) => {
    const value = parseFiniteNumber(item?.value)
    const hasData = value !== null
    const boundedPercent = hasData ? ((value - safeMin) / range) * 100 : null
    const height = hasData ? Math.min(Math.max(boundedPercent, 4), 96) : null

    return {
      id: `score-${item?.periodStart ?? index}`,
      x: series.length === 1 ? 50 : (index / denominator) * 100,
      height,
      value,
      hasData,
      label: formatDateLabel(item?.periodStart),
    }
  })
}

function buildLineSegments(series) {
  const validPoints = series.filter((point) => point.hasData)
  return validPoints.length > 1
    ? [validPoints.map((point) => `${point.x},${100 - point.height}`)]
    : []
}

function summarizeAnalysesTrend(series) {
  const values = series.map((item) => ({
    label: formatDateLabel(item?.periodStart),
    value: parseFiniteNumber(item?.value) ?? 0,
  }))
  const total = values.reduce((sum, item) => sum + item.value, 0)
  const peak = values.reduce((best, item) => (item.value > best.value ? item : best), { label: '—', value: 0 })
  const average = values.length ? total / values.length : 0

  return { total, peak, average }
}


function DashboardFilterSelect({ label, value, options, onChange, className = '' }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const selectId = useId()
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const optionRefs = useRef([])
  const labelId = `${selectId}-label`
  const listboxId = `${selectId}-listbox`
  const safeOptions = useMemo(() => (options.length ? options : [{ value: '', label: 'No options available', disabled: true }]), [options])
  const selectedIndex = Math.max(0, safeOptions.findIndex((option) => option.value === value))
  const selectedOption = safeOptions[selectedIndex] || safeOptions[0]

  useEffect(() => {
    if (!isOpen) return undefined

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    window.requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus())
  }, [activeIndex, isOpen])

  const openListbox = () => {
    setActiveIndex(selectedIndex)
    setIsOpen(true)
  }

  const closeAndFocusTrigger = () => {
    setIsOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const focusOption = (nextIndex) => {
    const boundedIndex = (nextIndex + safeOptions.length) % safeOptions.length
    setActiveIndex(boundedIndex)
    optionRefs.current[boundedIndex]?.focus()
  }

  const selectOption = (option) => {
    if (option.disabled) return
    onChange(option.value)
    closeAndFocusTrigger()
  }

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (isOpen) {
        setIsOpen(false)
      } else {
        openListbox()
      }
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openListbox()
    }
  }

  const handleOptionKeyDown = (event, index) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption(index + 1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(index - 1)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      focusOption(safeOptions.length - 1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectOption(safeOptions[index])
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndFocusTrigger()
    }
  }

  return (
    <div className={`new-dashboard__field ${className}`.trim()} ref={rootRef}>
      <span id={labelId} className="new-dashboard__field-label">{label}</span>
      <div className="new-dashboard__select-shell">
        <button
          ref={triggerRef}
          type="button"
          className="new-dashboard__select-trigger"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={`${labelId} ${selectId}-value`}
          aria-controls={listboxId}
          onClick={() => {
            if (isOpen) {
              setIsOpen(false)
            } else {
              openListbox()
            }
          }}
          onKeyDown={handleTriggerKeyDown}
        >
          <span id={`${selectId}-value`} className="new-dashboard__select-value">{selectedOption.label}</span>
          <ChevronDown className="new-dashboard__select-chevron" size={18} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {isOpen ? (
          <div id={listboxId} className="new-dashboard__select-menu" role="listbox" aria-labelledby={labelId} tabIndex={-1}>
            {safeOptions.map((option, index) => {
              const isSelected = option.value === value
              return (
                <button
                  key={option.value || `option-${index}`}
                  ref={(node) => { optionRefs.current[index] = node }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className={`new-dashboard__select-option${isSelected ? ' new-dashboard__select-option--selected' : ''}${index === activeIndex ? ' new-dashboard__select-option--active' : ''}`}
                  onClick={() => selectOption(option)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  onFocus={() => setActiveIndex(index)}
                >
                  <span className="new-dashboard__select-option-label">{option.label}</span>
                  {isSelected ? <Check className="new-dashboard__select-check" size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function summarizeScoreTrend(series, fallbackScoredCount = 0, fallbackAverage = null) {
  const scoredPoints = series
    .map((item) => ({
      label: formatDateLabel(item?.periodStart),
      value: parseFiniteNumber(item?.value),
      scoredCount: parseFiniteNumber(item?.scoredCount) ?? 0,
    }))
    .filter((item) => item.value !== null)
  const totalScoredCount = scoredPoints.reduce((sum, item) => sum + item.scoredCount, 0) || Number(fallbackScoredCount || 0)
  const weightedScoreTotal = scoredPoints.reduce((sum, item) => sum + (item.value * item.scoredCount), 0)
  const weightedAverage = totalScoredCount > 0 && weightedScoreTotal > 0 ? weightedScoreTotal / totalScoredCount : null
  const fallbackAverageValue = parseFiniteNumber(fallbackAverage)
  const average = weightedAverage ?? fallbackAverageValue ?? (scoredPoints.length
    ? scoredPoints.reduce((sum, item) => sum + item.value, 0) / scoredPoints.length
    : null)
  const highest = scoredPoints.reduce((best, item) => (best === null || item.value > best.value ? item : best), null)

  return { scoredPoints, average, highest, totalScoredCount }
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

  const defaultKpis = {
    analysesRunCount: 0,
    resumesAnalyzedCount: 0,
    completionRate: 0,
    avgScore: null,
    scoredCount: 0,
    shortlistedRate: 0,
  }
  const kpis = { ...defaultKpis, ...(dashboardData?.kpis || {}) }
  const usage = dashboardData?.usage
  const hasMonthlyResumeAnalysisLimit = Number.isFinite(Number(usage?.monthlyResumeAnalysisLimit))
  const monthlyResumeAnalysisLimit = hasMonthlyResumeAnalysisLimit
    ? formatCompactNumber(usage.monthlyResumeAnalysisLimit)
    : null

  const analysesTrend = useMemo(() => dashboardData?.charts?.analysesTrend || [], [dashboardData])
  const averageScoreTrend = useMemo(() => dashboardData?.charts?.averageScoreTrend || [], [dashboardData])
  const analysesSummary = useMemo(() => summarizeAnalysesTrend(analysesTrend), [analysesTrend])
  const scoreSummary = useMemo(() => summarizeScoreTrend(averageScoreTrend, kpis.scoredCount, kpis.avgScore), [averageScoreTrend, kpis.avgScore, kpis.scoredCount])
  const isAnalysesEmpty = fetchState === 'success' && (analysesTrend.length === 0 || analysesSummary.total <= 0)
  const validScorePointCount = scoreSummary.scoredPoints.length
  const isScoreEmpty = fetchState === 'success' && validScorePointCount === 0
  const analysesBars = useMemo(() => buildChartBars(analysesTrend, 'value'), [analysesTrend])
  const isAnalysesChartDense = analysesBars.length > 45
  const analysesMax = useMemo(() => Math.max(...analysesTrend.map((item) => parseFiniteNumber(item.value) ?? 0), 1), [analysesTrend])
  const analysesTicks = useMemo(() => buildAxisTicks(0, analysesMax, 4).map((value) => Math.round(value)), [analysesMax])
  const analysesDateTicks = useMemo(() => getIntermediateDateTicks(analysesTrend), [analysesTrend])
  const scoreValues = useMemo(() => averageScoreTrend.map((item) => parseFiniteNumber(item.value)).filter((value) => value !== null), [averageScoreTrend])
  const scoreMin = useMemo(() => (scoreValues.length ? Math.min(...scoreValues) : 0), [scoreValues])
  const scoreMax = useMemo(() => (scoreValues.length ? Math.max(...scoreValues) : 1), [scoreValues])
  const scoreAxisMin = useMemo(() => Math.max(0, scoreMin - 0.5), [scoreMin])
  const scoreAxisMax = useMemo(() => Math.max(scoreAxisMin + 1, scoreMax + 0.5), [scoreAxisMin, scoreMax])
  const scoreTicks = useMemo(() => buildAxisTicks(scoreAxisMin, scoreAxisMax, 4).map((value) => Number(value.toFixed(2))), [scoreAxisMin, scoreAxisMax])
  const averageScorePoints = useMemo(() => buildScoreChartPoints(averageScoreTrend, scoreAxisMin, scoreAxisMax), [averageScoreTrend, scoreAxisMin, scoreAxisMax])
  const scoreDateTicks = useMemo(() => getIntermediateDateTicks(averageScoreTrend), [averageScoreTrend])
  const showAnalysesChart = analysesTrend.length > 0 && !isAnalysesEmpty
  const showScoreChart = fetchState === 'success' && validScorePointCount > 0

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
            <DashboardFilterSelect
              label="Date range"
              value={rangeDays}
              onChange={setRangeDays}
              options={[
                { value: '7', label: 'Last 7 days' },
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' },
              ]}
            />
            <DashboardFilterSelect
              label="Job"
              value={jobDescriptionId}
              onChange={setJobDescriptionId}
              className="new-dashboard__field--wide"
              options={[
                { value: '', label: 'All jobs' },
                ...(dashboardData?.jobOptions || []).map((job) => ({ value: job.id, label: job.title })),
              ]}
            />
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
          { label: 'Analyses Run', value: kpis.analysesRunCount, iconName: 'file' },
          {
            label: 'Resumes Analyzed',
            value: formatCompactNumber(kpis.resumesAnalyzedCount),
            iconName: 'users',
            inlineMeta: monthlyResumeAnalysisLimit ? `/ ${monthlyResumeAnalysisLimit}` : null,
          },
          { label: 'Completion Rate', value: formatPercent(kpis.completionRate), iconName: 'target' },
          { label: 'Average Score', value: formatScore(kpis.avgScore), iconName: 'chart' },
          { label: 'Shortlisted Rate', value: formatPercent(kpis.shortlistedRate), iconName: 'users' },
        ].map(({ label, value, iconName, inlineMeta }) => (
          <article key={label} className="new-dashboard__kpi-card kpi-card">
            <div className="new-dashboard__kpi-top-row">
              <p className="new-dashboard__kpi-label kpi-card-label">{label}</p>
              <span className="new-dashboard__kpi-icon" aria-hidden="true"><Icon name={iconName} size="sm" tone="muted" /></span>
            </div>
            <div>
              <p className="new-dashboard__kpi-value kpi-card-value">
                {value}
                {inlineMeta ? <span className="new-dashboard__kpi-inline-meta">{inlineMeta}</span> : null}
              </p>
            </div>
          </article>
        ))}
      </section>

      <section className="new-dashboard__trends">
        <article className="new-dashboard__trend-card" role="region" aria-labelledby="dashboard-analyses-trend-title">
          <h3 id="dashboard-analyses-trend-title" className="new-dashboard__trend-title"><Icon name="chart" size="sm" tone="muted" className="new-dashboard__trend-title-icon" />Analyses trend</h3>
          <div className="new-dashboard__trend-summary" aria-label="Analyses trend summary">
            <span><strong>{formatCompactNumber(analysesSummary.total)}</strong>Total analyses</span>
            <span><strong>{formatCompactNumber(analysesSummary.peak.value)}</strong>Peak · {analysesSummary.peak.label}</span>
            <span><strong>{analysesSummary.average.toFixed(1)}</strong>Avg/day</span>
          </div>
          {loading ? <p className="new-dashboard__muted">Loading trend data…</p> : null}
          {hasFetchError ? <p className="new-dashboard__empty-state">Trend unavailable due to API error.</p> : null}
          {isAnalysesEmpty ? <p className="new-dashboard__empty-state">No analyses yet. Run an analysis to start tracking activity trends.</p> : null}
          {showAnalysesChart && (
            <div className="new-dashboard__chart-shell">
              <div className="new-dashboard__y-axis" aria-hidden="true">
                {analysesTicks.map((tick) => <span key={`analyses-tick-${tick}`}>{tick}</span>)}
              </div>
              <div className={`new-dashboard__chart ${isAnalysesChartDense ? 'new-dashboard__chart--dense' : ''}`} aria-label="Analyses trend bar chart with count axis and date ticks">
              {analysesBars.map((bar) => {
                const isPeak = bar.hasData && bar.value === analysesSummary.peak.value && analysesSummary.peak.value > 0
                return (
                  <button key={bar.id} type="button" className="new-dashboard__bar-column" aria-label={bar.hasData ? `${bar.label}: ${bar.value} analyses` : `${bar.label}: no data for this period`} data-tooltip={bar.hasData ? `${bar.label}: ${bar.value} analyses` : `${bar.label}: No data`} data-state={bar.hasData ? 'value' : 'missing'}>
                    <div className={`new-dashboard__bar ${bar.hasData ? 'new-dashboard__bar--primary' : 'new-dashboard__bar--missing'} ${isPeak ? 'new-dashboard__bar--peak' : ''}`} style={{ height: `${bar.height}%` }} />
                  </button>
                )
              })}
              </div>
            </div>
          )}
          {showAnalysesChart ? (
            <div className="new-dashboard__x-axis" aria-hidden="true">
              {analysesDateTicks.map((label) => <span key={`analyses-date-${label}`}>{label}</span>)}
            </div>
          ) : null}
        </article>

        <article className="new-dashboard__trend-card" role="region" aria-labelledby="dashboard-average-score-trend-title">
          <h3 id="dashboard-average-score-trend-title" className="new-dashboard__trend-title"><Icon name="target" size="sm" tone="muted" className="new-dashboard__trend-title-icon" />Average score trend</h3>
          <div className="new-dashboard__trend-summary" aria-label="Average score trend summary">
            <span><strong>{formatScore(scoreSummary.average)}</strong>Average score</span>
            <span><strong>{formatScore(scoreSummary.highest?.value)}</strong>High · {scoreSummary.highest?.label || '—'}</span>
            <span><strong>{formatCompactNumber(scoreSummary.totalScoredCount)}</strong>Scored</span>
          </div>
          {loading ? <p className="new-dashboard__muted">Loading trend data…</p> : null}
          {hasFetchError ? <p className="new-dashboard__empty-state">Trend unavailable due to API error.</p> : null}
          {isScoreEmpty && !loading && !hasFetchError ? <p className="new-dashboard__empty-state">No completed score data is available for the selected filters.</p> : null}
          {showScoreChart && (
            <div className="new-dashboard__chart-shell">
              <div className="new-dashboard__y-axis" aria-hidden="true">
                {scoreTicks.map((tick) => <span key={`score-tick-${tick}`}>{formatScore(tick)}</span>)}
              </div>
              <div className="new-dashboard__chart new-dashboard__chart--line" aria-label="Average score trend line chart with score axis and date ticks">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="new-dashboard__line-svg" aria-hidden="true">
                  {buildLineSegments(averageScorePoints).map((segment) => (
                    <polyline
                      key={segment.join('-')}
                      fill="none"
                      stroke="var(--color-accent-green)"
                      strokeWidth="2"
                      points={segment.join(' ')}
                    />
                  ))}
                </svg>
                {averageScorePoints.filter((point) => point.hasData).map((point) => (
                  <button
                    key={point.id}
                    type="button"
                    className="new-dashboard__point"
                    style={{ left: `${point.x}%`, bottom: `${point.height}%` }}
                    aria-label={`${point.label}: ${formatScore(point.value)} score`}
                    data-tooltip={`${point.label}: ${formatScore(point.value)} score`}
                    data-state="value"
                  />
                ))}
              </div>
            </div>
          )}
          {showScoreChart ? (
            <div className="new-dashboard__x-axis" aria-hidden="true">
              {scoreDateTicks.map((label) => <span key={`score-date-${label}`}>{label}</span>)}
            </div>
          ) : null}
        </article>
      </section>
    </div>
  )
}
