import { useEffect, useMemo, useState } from 'react'

function TrendCard({ label, value, suffix = '', delta = null }) {
  const deltaLabel = delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">
        {value}
        {suffix}
      </p>
      <p className={`mt-1 text-sm ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{deltaLabel}</p>
    </div>
  )
}

function TinyTrend({ data = [], dataKey }) {
  const points = data.map((item, index) => ({ x: index * 28 + 8, y: Number(item[dataKey] || 0) }))
  const max = Math.max(...points.map((point) => point.y), 1)
  const normalized = points.map((point) => `${point.x},${40 - (point.y / max) * 34}`).join(' ')

  return (
    <svg viewBox="0 0 300 40" className="h-12 w-full">
      <polyline points={normalized} fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-600" />
    </svg>
  )
}

export default function AnalyticsDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState({ latest: null, trends: [], revenueByPlan: [] })

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/admin/analytics/summary?days=30', { credentials: 'include' })
        if (!response.ok) {
          throw new Error('Failed to load analytics summary')
        }

        const data = await response.json()
        setSummary(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [])

  const deltas = useMemo(() => {
    const trends = summary.trends || []
    if (trends.length < 2) {
      return {}
    }

    const latest = trends[trends.length - 1]
    const previous = trends[trends.length - 2]

    const asDelta = (key) => {
      const prev = Number(previous?.[key] || 0)
      const next = Number(latest?.[key] || 0)
      if (prev === 0) {
        return next === 0 ? 0 : 100
      }
      return ((next - prev) / prev) * 100
    }

    return {
      dau: asDelta('dau'),
      wau: asDelta('wau'),
      mau: asDelta('mau'),
      conversion_rate: asDelta('conversion_rate'),
      churn_rate: asDelta('churn_rate'),
      parsing_success_rate: asDelta('parsing_success_rate'),
      arpu: asDelta('arpu'),
      mrr: asDelta('mrr'),
    }
  }, [summary.trends])

  if (loading) {
    return <div className="p-6 text-slate-600">Loading analytics…</div>
  }

  if (error) {
    return <div className="p-6 text-rose-600">{error}</div>
  }

  const latest = summary.latest || {}

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Founder Analytics Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <TrendCard label="DAU" value={latest.dau || 0} delta={deltas.dau} />
        <TrendCard label="WAU" value={latest.wau || 0} delta={deltas.wau} />
        <TrendCard label="MAU" value={latest.mau || 0} delta={deltas.mau} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <TrendCard label="Signup → Payment" value={latest.conversion_rate || 0} suffix="%" delta={deltas.conversion_rate} />
        <TrendCard label="Churn (monthly)" value={latest.churn_rate || 0} suffix="%" delta={deltas.churn_rate} />
        <TrendCard label="Parsing Success" value={latest.parsing_success_rate || 0} suffix="%" delta={deltas.parsing_success_rate} />
        <TrendCard label="ARPU" value={`$${latest.arpu || 0}`} delta={deltas.arpu} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Revenue Trend (MRR)</h2>
          <TinyTrend data={summary.trends} dataKey="mrr" />
          <p className="text-sm text-slate-500">Current MRR: ${latest.mrr || 0}</p>
          <p className="text-sm text-slate-500">Current ARR: ${latest.arr || 0}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Parsing Success Trend</h2>
          <TinyTrend data={summary.trends} dataKey="parsing_success_rate" />
          <p className="text-sm text-slate-500">30-day trend of parse_success vs parse_fail events.</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">ARPU by Plan Type</h2>
        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Revenue</th>
                <th className="py-2 pr-4">Paying Users</th>
                <th className="py-2 pr-4">ARPU</th>
              </tr>
            </thead>
            <tbody>
              {(summary.revenueByPlan || []).map((row) => (
                <tr key={`${row.metric_month}-${row.plan_type}`} className="border-b border-slate-100">
                  <td className="py-2 pr-4">{String(row.metric_month).slice(0, 10)}</td>
                  <td className="py-2 pr-4">{row.plan_type}</td>
                  <td className="py-2 pr-4">${row.revenue}</td>
                  <td className="py-2 pr-4">{row.paying_users}</td>
                  <td className="py-2 pr-4">${row.arpu}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
