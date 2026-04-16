import ConversionFunnel from '../components/ConversionFunnel'
import MetricCard from '../components/MetricCard'
import RevenueChart from '../components/RevenueChart'
import UserGrowthChart from '../components/UserGrowthChart'
import useAdminAnalytics from '../hooks/useAdminAnalytics'
import StateAlert from '../components/StateAlert'
import { EmptyState } from '../components/WidgetState'

function money(amount = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(amount || 0))
}

function pct(value = 0) {
  return `${Number(value || 0).toFixed(2)}%`
}

function getGrowthTrend(series = [], key) {
  const first = Number(series[0]?.[key] || 0)
  const last = Number(series[series.length - 1]?.[key] || 0)
  if (!first) return last ? 100 : 0
  return ((last - first) / first) * 100
}

function cohortColor(value, maxValue) {
  if (!value) return '#f1f5f9'
  const ratio = Math.min(1, value / Math.max(1, maxValue))
  const blue = Math.round(245 - (ratio * 120))
  const green = Math.round(248 - (ratio * 90))
  return `rgb(99, ${green}, ${blue})`
}

export default function AdminAnalyticsPage() {
  const {
    analytics,
    loading,
    error,
    filters,
    range,
    applyPreset,
    updateCustomDate,
    refresh,
    exportCsv,
  } = useAdminAnalytics()

  const parsingTotals = analytics?.parsingTrend?.reduce((acc, row) => {
    acc.success += Number(row.success || 0)
    acc.failed += Number(row.failed || 0)
    return acc
  }, { success: 0, failed: 0 }) || { success: 0, failed: 0 }

  const parseFailRate = parsingTotals.failed + parsingTotals.success === 0
    ? 0
    : (parsingTotals.failed / (parsingTotals.failed + parsingTotals.success)) * 100

  const retentionMax = Math.max(0, ...(analytics?.retentionCohorts || []).map((row) => Number(row.retained_users || 0)))

  return (
    <main className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin Analytics Dashboard</h1>
          <p className="text-sm text-slate-500">Founder-facing metrics, cohorts, plan mix, and trend charts.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="ui-btn">Refresh</button>
          <button onClick={exportCsv} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">Export CSV</button>
        </div>
      </header>

      <section className="ui-card p-4">
        <div className="flex flex-wrap gap-2">
          {[
            { key: '30d', label: '30d' },
            { key: '90d', label: '90d' },
            { key: '1y', label: '1y' },
            { key: 'custom', label: 'Custom' },
          ].map((option) => (
            <button
              key={option.key}
              onClick={() => applyPreset(option.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${range === option.key ? 'bg-slate-900 text-white' : 'border border-slate-300 hover:bg-slate-50'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-700">Start date
            <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" type="date" value={filters.startDate} onChange={(event) => updateCustomDate('startDate', event.target.value)} />
          </label>
          <label className="text-sm text-slate-700">End date
            <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" type="date" value={filters.endDate} onChange={(event) => updateCustomDate('endDate', event.target.value)} />
          </label>
        </div>
      </section>

      {loading ? <div className="ui-card p-4 text-slate-600">Loading analytics…</div> : null}
      {error ? <StateAlert state={error} onRetry={refresh} /> : null}

      {!loading && !error && !analytics ? (
        <EmptyState title="No analytics data yet" description="No records match the selected date range. Try expanding the range and refresh." action={<button onClick={refresh} className="mt-3 ui-btn">Retry</button>} />
      ) : null}

      {analytics && !error ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="MRR" value={money(analytics.kpis.mrr)} trend={getGrowthTrend(analytics.userGrowth, 'mau')} />
            <MetricCard label="ARR" value={money(analytics.kpis.arr)} trend={getGrowthTrend(analytics.userGrowth, 'wau')} />
            <MetricCard label="Churn Rate" value={pct(analytics.kpis.churnRate)} trend={-1 * getGrowthTrend(analytics.userGrowth, 'dau')} />
            <MetricCard label="ARPU" value={money(analytics.kpis.arpu)} helper="Avg per paid user" />
            <MetricCard label="Active Users" value={analytics.kpis.totalUsers} helper="All-time users" />
            <MetricCard label="Forecast MRR" value={money(analytics.kpis.forecastNextMonthMrr || 0)} helper="Next month projection" />
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <RevenueChart data={analytics.revenueTrend || []} />
            <UserGrowthChart data={analytics.userGrowth || []} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ConversionFunnel signups={analytics.conversionFunnel?.signups} verified={analytics.conversionFunnel?.verified} paid={analytics.conversionFunnel?.paid} />

            <section className="ui-card p-4">
              <h2 className="text-lg font-medium text-slate-900">Plan Breakdown</h2>
              <div className="mt-4 space-y-3">
                {(analytics.planBreakdown || []).map((plan) => (
                  <div key={plan.plan}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="capitalize">{plan.plan}</span>
                      <strong>{plan.users} users ({pct(plan.user_pct)})</strong>
                    </div>
                    <div className="h-4 rounded bg-slate-100">
                      <div className="h-full rounded bg-indigo-500" style={{ width: `${Math.max(3, Number(plan.user_pct || 0))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="ui-card p-4">
              <h2 className="text-lg font-medium text-slate-900">Parsing Stats</h2>
              <div className="mt-3 space-y-2 text-sm">
                <p className="flex items-center justify-between"><span>Success Rate</span> <strong>{pct(analytics.kpis.parsingSuccessRate)}</strong></p>
                <p className="flex items-center justify-between"><span>Successful Parses</span> <strong>{parsingTotals.success}</strong></p>
                <p className="flex items-center justify-between"><span>Failed Parses</span> <strong>{parsingTotals.failed}</strong></p>
                <p className="flex items-center justify-between"><span>Failure Breakdown</span> <strong>{pct(parseFailRate)} fail</strong></p>
              </div>
            </section>
          </div>

          <section className="ui-card p-4">
            <h2 className="text-lg font-medium text-slate-900">Retention Cohorts Heatmap</h2>
            <div className="mt-4 overflow-auto">
              <div className="grid min-w-[720px] grid-cols-[160px_repeat(10,minmax(0,1fr))] gap-2 text-xs">
                <div className="font-medium text-slate-500">Cohort</div>
                {Array.from({ length: 10 }, (_, offset) => <div key={offset} className="text-center font-medium text-slate-500">W+{offset}</div>)}
                {[...new Set((analytics.retentionCohorts || []).map((row) => row.cohort_week))].map((cohort) => {
                  const weekRows = (analytics.retentionCohorts || []).filter((row) => row.cohort_week === cohort)
                  return (
                    <div key={cohort} className="contents">
                      <div key={`${cohort}-label`} className="rounded bg-slate-50 p-2 text-slate-600">{new Date(cohort).toLocaleDateString()}</div>
                      {Array.from({ length: 10 }, (_, offset) => {
                        const retained = Number(weekRows.find((row) => row.week_offset === offset)?.retained_users || 0)
                        return (
                          <div
                            key={`${cohort}-${offset}`}
                            title={`Week ${offset}: ${retained} users`}
                            className="rounded p-2 text-center font-medium text-slate-700"
                            style={{ backgroundColor: cohortColor(retained, retentionMax) }}
                          >
                            {retained}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          <section className="ui-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-medium text-slate-900">Weekly UX Health (Founder Review)</h2>
              <span className="text-xs text-slate-500">
                {analytics.uxWeeklyReport?.dateRange?.startDate} → {analytics.uxWeeklyReport?.dateRange?.endDate}
              </span>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded border border-slate-200 p-3 text-sm">
                <p className="text-slate-500">2FA completion rate</p>
                <p className="text-xl font-semibold text-slate-900">{pct(analytics.uxWeeklyReport?.twoFactorCompletionRate || 0)}</p>
                <p className="text-xs text-slate-500">{analytics.uxWeeklyReport?.twoFactorCompleted || 0}/{analytics.uxWeeklyReport?.twoFactorStarted || 0} completed</p>
              </div>
              <div className="rounded border border-slate-200 p-3 text-sm">
                <p className="text-slate-500">Admin page feedback</p>
                <p className="text-xl font-semibold text-slate-900">{analytics.uxWeeklyReport?.adminFeedbackSummary?.total || 0}</p>
                <p className="text-xs text-slate-500">{analytics.uxWeeklyReport?.adminFeedbackSummary?.notUseful || 0} marked not useful</p>
              </div>
              <div className="rounded border border-slate-200 p-3 text-sm">
                <p className="text-slate-500">Tracked blockers</p>
                <p className="text-xl font-semibold text-slate-900">{analytics.uxBlockers?.length || 0}</p>
                <p className="text-xs text-slate-500">By event frequency in selected window</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Top blockers by frequency</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {(analytics.uxWeeklyReport?.topBlockers || []).map((blocker, index) => (
                    <li key={`${blocker.event_type}-${index}`} className="rounded border border-slate-200 p-2">
                      <p className="font-medium text-slate-900">#{index + 1} {blocker.event_type}</p>
                      <p className="text-slate-600">Route: {blocker.route}</p>
                      <p className="text-slate-600">Frequency: {blocker.frequency}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-800">Data-backed next sprint priorities</h3>
                <ol className="mt-2 space-y-2 text-sm">
                  {(analytics.uxWeeklyReport?.nextSprintPriorities || []).map((item) => (
                    <li key={`${item.rank}-${item.blocker}`} className="rounded border border-indigo-100 bg-indigo-50/40 p-2">
                      <p className="font-medium text-slate-900">{item.rank}. {item.blocker} ({item.frequency})</p>
                      <p className="text-slate-700">{item.recommendation}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </main>
  )
}
