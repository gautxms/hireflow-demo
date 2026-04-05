import { useCallback, useEffect, useMemo, useState } from 'react'
import RefundModal from '../components/RefundModal'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

export default function AdminSubscriptionsPage() {
  const [filters, setFilters] = useState({ status: 'all', plan: 'all', startDate: '', endDate: '' })
  const [subscriptions, setSubscriptions] = useState([])
  const [selectedSubscription, setSelectedSubscription] = useState(null)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isRefundOpen, setIsRefundOpen] = useState(false)

  const adminId = useMemo(() => localStorage.getItem('admin_id') || 'founder_admin', [])

  const loadSubscriptions = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value)
      })

      const response = await fetch(`/api/admin/subscriptions?${params.toString()}`, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to load subscriptions')
      const payload = await response.json()
      setSubscriptions(payload.subscriptions || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void loadSubscriptions()
  }, [loadSubscriptions])

  const openDetails = async (subscription) => {
    setSelectedSubscription(subscription)
    setDetails(null)
    const response = await fetch(`/api/admin/subscriptions/${subscription.id}`, { credentials: 'include' })
    const payload = await response.json()
    if (response.ok) {
      const latest = payload.transactions?.[0]
      setDetails(payload)
      setSelectedSubscription((previous) => ({
        ...previous,
        latestTransactionId: latest?.transactionId || null,
      }))
    }
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin Subscription Management</h1>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4">
        <select className="rounded-md border border-slate-300 px-3 py-2" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="cancelled">Cancelled</option>
          <option value="trialing">Trialing</option>
        </select>
        <select className="rounded-md border border-slate-300 px-3 py-2" value={filters.plan} onChange={(e) => setFilters((f) => ({ ...f, plan: e.target.value }))}>
          <option value="all">All plans</option>
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>
        <input type="date" className="rounded-md border border-slate-300 px-3 py-2" value={filters.startDate} onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))} />
        <input type="date" className="rounded-md border border-slate-300 px-3 py-2" value={filters.endDate} onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))} />
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Renewal</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={6}>Loading…</td></tr>
            ) : subscriptions.map((subscription) => (
              <tr key={subscription.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{subscription.email}</td>
                <td className="px-4 py-3">{subscription.status}</td>
                <td className="px-4 py-3">{subscription.plan}</td>
                <td className="px-4 py-3">{formatDate(subscription.startedAt)}</td>
                <td className="px-4 py-3">{formatDate(subscription.renewalDate)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button className="rounded-md border border-slate-300 px-3 py-1.5" onClick={() => openDetails(subscription)}>View</button>
                    <button className="rounded-md bg-rose-600 px-3 py-1.5 text-white" onClick={() => {
                      setSelectedSubscription(subscription)
                      setIsRefundOpen(true)
                    }}>Refund</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {details?.subscription ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-medium text-slate-900">Subscription Details</h2>
            <dl className="mt-3 space-y-1 text-sm">
              <div><dt className="inline text-slate-500">Email:</dt> <dd className="inline">{details.subscription.email}</dd></div>
              <div><dt className="inline text-slate-500">Paddle Subscription:</dt> <dd className="inline">{details.subscription.paddleSubscriptionId || '—'}</dd></div>
              <div><dt className="inline text-slate-500">Next Billing:</dt> <dd className="inline">{formatDate(details.subscription.nextBillingDate)}</dd></div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-medium text-slate-900">Refund Audit Trail</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(details.refundAuditTrail || []).map((item) => (
                <li key={item.id} className="rounded border border-slate-100 p-2">
                  {formatDate(item.createdAt)} · {item.reason} · ${((item.amountCents || 0) / 100).toFixed(2)} · admin: {item.adminId}
                </li>
              ))}
              {!details.refundAuditTrail?.length ? <li className="text-slate-500">No refunds issued.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}

      <RefundModal
        isOpen={isRefundOpen}
        subscription={selectedSubscription}
        adminId={adminId}
        onClose={() => setIsRefundOpen(false)}
        onSuccess={() => {
          void loadSubscriptions()
          if (selectedSubscription) {
            void openDetails(selectedSubscription)
          }
        }}
      />
    </div>
  )
}
