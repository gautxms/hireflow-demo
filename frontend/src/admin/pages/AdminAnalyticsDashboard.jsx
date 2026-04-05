import { useCallback, useEffect, useMemo, useState } from 'react'
import MetricCard from '../components/MetricCard'
import RevenueChart from '../components/RevenueChart'
import UserGrowthChart from '../components/UserGrowthChart'

function money(amount = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(amount || 0))
}

function day(value) {
  return value ? new Date(value).toLocaleDateString() : '—'
}

function percent(value = 0) {
  return `${Number(value || 0).toFixed(2)}%`
}

function getDefaultRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 89)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

export default function AdminAnalyticsDashboard() {
  const defaults = useMemo(() => getDefaultRange(), [])
  const [filters, setFilters] = useState({ ...defaults, planType: 'all' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analytics, setAnalytics] = useState(null)

  const loadAnalytics = useCallback(async (currentFilters = filters, { silent = false } = {}) => {
    try {
      if (!silent) setLoading(true)
      setError('')
      const params = new URLSearchParams(currentFilters)
      const response = await fetch(`/api/admin/analytics?${params.toString()}`, { credentials: 'include' })

      if (!response.ok) {
        throw new Error('Failed to load admin analytics dashboard')
      }

      const payload = await response.json()
      setAnalytics(payload)
    } catch (err) {
      setError(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void loadAnalytics(filters)
    const intervalId = window.setInterval(() => {
      void loadAnalytics(filters, { silent: true })
    }, 5 * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [filters, loadAnalytics])

  const onApplyFilters = (event) => {
    event.preventDefault()
    void loadAnalytics(filters)
  }

  const onExportCsv = () => {
    const params = new URLSearchParams({ ...filters, export: 'csv' })
    window.open(`/api/admin/analytics?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  const latestGrowth = analytics?.userGrowth?.[analytics.userGrowth.length - 1]
  const oldestGrowth = analytics?.userGrowth?.[0]
  const growthDelta = (key) => {
    const startValue = Number(oldestGrowth?.[key] || 0)
    const latestValue = Number(latestGrowth?.[key] || 0)
    if (startValue === 0) return latestValue === 0 ? 0 : 100
    return ((latestValue - startValue) / startValue) * 100
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin Analytics & Reporting Dashboard</h1>
          <p className="text-sm text-slate-500">Revenue, growth, usage, retention, and conversion tracking for founders.</p>
        </div>
        <button onClick={onExportCsv} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">Export CSV</button>
      </header>

      <form onSubmit={onApplyFilters} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4">
        <label className="text-sm text-slate-700">Start date
          <input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm text-slate-700">End date
          <input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm text-slate-700">Plan type
          <select value={filters.planType} onChange={(event) => setFilters((current) => ({ ...current, planType: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5">
            <option value="all">All plans</option>
            <option value="monthly">Monthly only</option>
            <option value="annual">Annual only</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Apply filters</button>
        </div>
      </form>

      {loading ? <p className="text-slate-600">Loading analytics…</p> : null}
      {error ? <p className="text-rose-600">{error}</p> : null}

      {analytics ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="MRR" value={money(analytics.kpis.mrr)} trend={growthDelta('mau')} helper={`Forecast: ${money(analytics.kpis.forecastNextMonthMrr)}`} />
            <MetricCard label="ARR" value={money(analytics.kpis.arr)} trend={growthDelta('wau')} helper="Annualized recurring revenue" />
            <MetricCard label="Churn rate" value={percent(analytics.kpis.churnRate)} trend={-1 * growthDelta('dau')} helper="Cancelled subs / total subs" />
            <MetricCard label="ARPU" value={money(analytics.kpis.arpu)} trend={growthDelta('mau')} helper="Average revenue per paid user" />
            <MetricCard label="Total users" value={analytics.kpis.totalUsers} trend={growthDelta('mau')} />
            <MetricCard label="Conversion" value={percent(analytics.kpis.conversionRate)} helper="Paid users / signups" />
            <MetricCard label="Parsing success" value={percent(analytics.kpis.parsingSuccessRate)} helper="parse_success / total parsing attempts" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <RevenueChart data={analytics.revenueTrend} />
            <UserGrowthChart data={analytics.userGrowth} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-medium text-slate-900">Conversion Funnel</h2>
              <div className="mt-4 space-y-2 text-sm">
                {[{ label: 'Signups', value: analytics.conversionFunnel.signups }, { label: 'Verified', value: analytics.conversionFunnel.verified }, { label: 'Paid', value: analytics.conversionFunnel.paid }].map((step) => (
                  <div key={step.label} className="rounded-md border border-slate-100 p-3">
                    <div className="flex items-center justify-between"><span>{step.label}</span><strong>{step.value}</strong></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-medium text-slate-900">Plan Mix (Monthly vs Annual)</h2>
              <div className="mt-3 space-y-2 text-sm">
                {analytics.planBreakdown.map((item) => (
                  <div key={item.plan}>
                    <div className="mb-1 flex items-center justify-between"><span className="capitalize">{item.plan}</span><span>{item.users} users · {percent(item.user_pct)}</span></div>
                    <div className="h-3 rounded bg-slate-100"><div className="h-full rounded bg-indigo-500" style={{ width: `${Math.max(1, Number(item.user_pct || 0))}%` }} /></div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-medium text-slate-900">Parsing Success Trend</h2>
              <div className="mt-3 max-h-56 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-slate-500"><tr><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Success</th><th className="py-2 pr-2">Failed</th><th className="py-2 pr-2">Rate</th></tr></thead>
                  <tbody>
                    {analytics.parsingTrend.slice(-14).map((row) => <tr key={row.day} className="border-t border-slate-100"><td className="py-2 pr-2">{day(row.day)}</td><td className="py-2 pr-2">{row.success}</td><td className="py-2 pr-2">{row.failed}</td><td className="py-2 pr-2">{percent(row.success_rate)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-medium text-slate-900">API Usage by Endpoint</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {analytics.apiUsage.map((row) => (
                  <li key={row.endpoint} className="flex items-center justify-between rounded border border-slate-100 px-3 py-2">
                    <span className="font-mono text-xs">{row.endpoint}</span>
                    <strong>{row.hits}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-medium text-slate-900">Retention Cohorts (Signup Week)</h2>
            <div className="mt-3 overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-500"><tr><th className="py-2 pr-3">Cohort Week</th><th className="py-2 pr-3">Week Offset</th><th className="py-2 pr-3">Retained Users</th></tr></thead>
                <tbody>
                  {analytics.retentionCohorts.slice(-80).map((row) => (
                    <tr key={`${row.cohort_week}-${row.week_offset}`} className="border-t border-slate-100">
                      <td className="py-2 pr-3">{day(row.cohort_week)}</td>
                      <td className="py-2 pr-3">W+{row.week_offset}</td>
                      <td className="py-2 pr-3">{row.retained_users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Last refreshed {new Date(analytics.generatedAt).toLocaleString()}.</p>
          </section>
        </>
      ) : null}
    </div>
  )
}
