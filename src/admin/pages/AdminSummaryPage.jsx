import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { navigateAdmin } from '../config/adminNavigation'
import { adminFetchJson, getMappedError } from '../utils/adminErrorState'

function toDateOnly(value) {
  return value.toISOString().slice(0, 10)
}

function getDateRanges() {
  const end = new Date()
  const todayStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
  const sevenDayStart = new Date(todayStart)
  sevenDayStart.setUTCDate(todayStart.getUTCDate() - 6)
  const prevSevenDayStart = new Date(sevenDayStart)
  prevSevenDayStart.setUTCDate(sevenDayStart.getUTCDate() - 7)
  const prevSevenDayEnd = new Date(sevenDayStart)
  prevSevenDayEnd.setUTCDate(sevenDayStart.getUTCDate() - 1)

  return {
    today: toDateOnly(todayStart),
    last7Start: toDateOnly(sevenDayStart),
    last7End: toDateOnly(todayStart),
    previous7Start: toDateOnly(prevSevenDayStart),
    previous7End: toDateOnly(prevSevenDayEnd),
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(amount || 0))
}

function formatDelta(value, { currency = false } = {}) {
  const numeric = Number(value || 0)
  const sign = numeric > 0 ? '+' : ''
  if (currency) return `${sign}${formatCurrency(numeric)}`
  return `${sign}${numeric.toLocaleString('en-US')}`
}

function buildUploadsLink(filters) {
  const params = new URLSearchParams(filters)
  return `/admin/uploads?${params.toString()}`
}

function buildLogsLink(filters) {
  const params = new URLSearchParams(filters)
  return `/admin/logs?${params.toString()}`
}

export default function AdminSummaryPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  useEffect(() => {
    const ranges = getDateRanges()
    const controller = new AbortController()

    const load = async () => {
      try {
        setLoading(true)
        setError('')

        const todayAnalyticsParams = new URLSearchParams({ startDate: ranges.today, endDate: ranges.today })
        const last7AnalyticsParams = new URLSearchParams({ startDate: ranges.last7Start, endDate: ranges.last7End })
        const prev7AnalyticsParams = new URLSearchParams({ startDate: ranges.previous7Start, endDate: ranges.previous7End })
        const todayUploadsParams = new URLSearchParams({ startDate: ranges.today, endDate: ranges.today, status: 'failed' })
        const last7UploadsParams = new URLSearchParams({ startDate: ranges.last7Start, endDate: ranges.last7End, status: 'failed' })

        const [todayAnalytics, last7Analytics, prev7Analytics, todayUploadStats, last7UploadStats, payments, health] = await Promise.all([
          adminFetchJson(`${API_BASE}/admin/analytics?${todayAnalyticsParams.toString()}`, 'Failed to load admin analytics', { signal: controller.signal }),
          adminFetchJson(`${API_BASE}/admin/analytics?${last7AnalyticsParams.toString()}`, 'Failed to load admin analytics', { signal: controller.signal }),
          adminFetchJson(`${API_BASE}/admin/analytics?${prev7AnalyticsParams.toString()}`, 'Failed to load admin analytics', { signal: controller.signal }),
          adminFetchJson(`${API_BASE}/admin/uploads/stats?${todayUploadsParams.toString()}`, 'Failed to load upload stats', { signal: controller.signal }),
          adminFetchJson(`${API_BASE}/admin/uploads/stats?${last7UploadsParams.toString()}`, 'Failed to load upload stats', { signal: controller.signal }),
          adminFetchJson(`${API_BASE}/admin/payments`, 'Failed to load payment admin data', { signal: controller.signal }),
          adminFetchJson(`${API_BASE}/admin/health`, 'Failed to load admin health data', { signal: controller.signal }),
        ])

        const paymentTransactions = payments.transactions || []
        const todayPaymentIssues = paymentTransactions.filter((transaction) => (
          ['failed', 'past_due', 'unpaid'].includes(String(transaction.status || '').toLowerCase())
          && String(transaction.billedAt || '').slice(0, 10) === ranges.today
        )).length
        const last7PaymentIssues = paymentTransactions.filter((transaction) => (
          ['failed', 'past_due', 'unpaid'].includes(String(transaction.status || '').toLowerCase())
          && String(transaction.billedAt || '').slice(0, 10) >= ranges.last7Start
          && String(transaction.billedAt || '').slice(0, 10) <= ranges.last7End
        )).length

        setData({
          ranges,
          kpis: {
            mrr: {
              today: Number(todayAnalytics?.kpis?.mrr || 0),
              last7: Number(last7Analytics?.kpis?.mrr || 0),
              previous7: Number(prev7Analytics?.kpis?.mrr || 0),
            },
            activeUsers: {
              today: Number(todayAnalytics?.userGrowth?.slice(-1)?.[0]?.dau || 0),
              last7: Number(last7Analytics?.userGrowth?.slice(-1)?.[0]?.wau || 0),
              previous7: Number(prev7Analytics?.userGrowth?.slice(-1)?.[0]?.wau || 0),
            },
            failedUploads: {
              today: Number(todayUploadStats?.failures?.total || 0),
              last7: Number(last7UploadStats?.failures?.total || 0),
            },
            paymentIssues: {
              today: todayPaymentIssues,
              last7: last7PaymentIssues,
            },
          },
          alerts: health?.alerts || [],
          incidents: health?.systemStatus || 'unknown',
          failedPayments: payments?.failedPayments || [],
        })
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          const mapped = getMappedError(requestError)
          setError(`${mapped.title}: ${mapped.cause}`)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => controller.abort()
  }, [])

  const cards = useMemo(() => {
    if (!data) return []
    const { ranges, kpis } = data
    return [
      {
        title: 'MRR trend',
        value: formatCurrency(kpis.mrr.last7),
        delta: formatDelta(kpis.mrr.last7 - kpis.mrr.previous7, { currency: true }),
        sublabel: `today ${formatCurrency(kpis.mrr.today)} · last 7 days ${formatCurrency(kpis.mrr.last7)}`,
        link: `/admin/analytics?startDate=${ranges.last7Start}&endDate=${ranges.last7End}`,
      },
      {
        title: 'Active users',
        value: kpis.activeUsers.last7.toLocaleString('en-US'),
        delta: formatDelta(kpis.activeUsers.last7 - kpis.activeUsers.previous7),
        sublabel: `today ${kpis.activeUsers.today.toLocaleString('en-US')} · last 7 days ${kpis.activeUsers.last7.toLocaleString('en-US')}`,
        link: `/admin/users?status=active`,
      },
      {
        title: 'Failed uploads',
        value: kpis.failedUploads.last7.toLocaleString('en-US'),
        delta: `today ${kpis.failedUploads.today.toLocaleString('en-US')}`,
        sublabel: 'Parse failures requiring operational review.',
        link: buildUploadsLink({ status: 'failed', startDate: ranges.last7Start, endDate: ranges.last7End }),
      },
      {
        title: 'Payment issues',
        value: kpis.paymentIssues.last7.toLocaleString('en-US'),
        delta: `today ${kpis.paymentIssues.today.toLocaleString('en-US')}`,
        sublabel: 'Failed / past-due invoices in tracked window.',
        link: '/admin/billing?status=failed',
      },
      {
        title: 'Incident status',
        value: String(data.incidents || 'unknown').toUpperCase(),
        delta: `${data.alerts.length} active alert(s)`,
        sublabel: 'Service health and infrastructure incidents.',
        link: '/admin/health',
      },
    ]
  }, [data])

  if (loading) return <div className="p-6 text-slate-600">Loading admin summary…</div>
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>

  const unresolvedPayments = data?.failedPayments?.length || 0
  const failedUploadCount = data?.kpis?.failedUploads?.last7 || 0
  const hasActiveIncidents = (data?.alerts?.length || 0) > 0

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Operational summary</h2>
        <p className="mt-1 text-sm text-slate-600">
          Comparing today ({data.ranges.today}) versus rolling 7-day activity ({data.ranges.last7Start} to {data.ranges.last7End}).
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <button
            key={card.title}
            type="button"
            className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
            onClick={() => navigateAdmin(card.link)}
          >
            <p className="text-sm text-slate-500">{card.title}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{card.value}</p>
            <p className="mt-1 text-sm font-medium text-indigo-700">{card.delta}</p>
            <p className="mt-2 text-xs text-slate-500">{card.sublabel}</p>
          </button>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-base font-semibold text-slate-900">Operational alerts</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.alerts || []).map((alert, index) => (
              <li key={`${alert.severity}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <strong className="uppercase">{alert.severity}</strong>: {alert.message}
              </li>
            ))}
            {!data.alerts?.length ? <li className="text-slate-600">No active alerts.</li> : null}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-base font-semibold text-slate-900">Top action prompts</h3>
          <div className="mt-3 space-y-2">
            <QuickAction
              title="Review failed parses"
              description={`${failedUploadCount} failures in last 7 days.`}
              href={buildUploadsLink({ status: 'failed', startDate: data.ranges.last7Start, endDate: data.ranges.last7End })}
            />
            <QuickAction
              title="Resolve payment issues"
              description={`${unresolvedPayments} unresolved failed/retrying payments.`}
              href="/admin/billing?status=failed"
            />
            <QuickAction
              title="Inspect active incidents"
              description={hasActiveIncidents ? `${data.alerts.length} active alerts need triage.` : 'No active incidents right now.'}
              href="/admin/health"
            />
            <QuickAction
              title="Investigate error spikes"
              description="Open error logs scoped to the last 7 days."
              href={buildLogsLink({ startDate: data.ranges.last7Start, endDate: data.ranges.last7End })}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function QuickAction({ title, description, href }) {
  return (
    <button
      type="button"
      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-indigo-300 hover:bg-indigo-50"
      onClick={() => navigateAdmin(href)}
    >
      <p className="font-medium text-slate-900">{title}</p>
      <p className="text-sm text-slate-600">{description}</p>
    </button>
  )
}
