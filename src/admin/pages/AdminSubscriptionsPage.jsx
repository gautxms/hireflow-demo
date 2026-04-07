import { useMemo, useState } from 'react'
import RefundModal from '../components/RefundModal'
import SubscriptionsTable from '../components/SubscriptionsTable'
import useAdminSubscriptions from '../hooks/useAdminSubscriptions'

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function formatCurrency(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

export default function AdminSubscriptionsPage() {
  const [isRefundOpen, setIsRefundOpen] = useState(false)
  const [refundTarget, setRefundTarget] = useState(null)
  const {
    filters,
    setFilters,
    sort,
    setSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    loading,
    detailsLoading,
    error,
    subscriptions,
    totalSubscriptions,
    selectedId,
    selectedDetails,
    refreshSubscriptions,
    loadDetails,
  } = useAdminSubscriptions()

  const adminId = useMemo(() => localStorage.getItem('admin_id') || 'founder_admin', [])

  const currentSubscription = selectedDetails?.subscription

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin subscriptions</h1>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4">
        <select className="rounded-md border border-slate-300 px-3 py-2" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="cancelled">Cancelled</option>
          <option value="overdue">Overdue</option>
        </select>

        <select className="rounded-md border border-slate-300 px-3 py-2" value={filters.plan} onChange={(event) => setFilters((prev) => ({ ...prev, plan: event.target.value }))}>
          <option value="all">All plans</option>
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>

        <select className="rounded-md border border-slate-300 px-3 py-2" value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))}>
          <option value="10">10 per page</option>
          <option value="25">25 per page</option>
          <option value="50">50 per page</option>
        </select>

        <p className="self-center text-sm text-slate-500">{totalSubscriptions} matching subscriptions</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <SubscriptionsTable
        subscriptions={subscriptions}
        loading={loading}
        sort={sort}
        onSortChange={setSort}
        onView={(subscription) => void loadDetails(subscription.id)}
        onRefund={(subscription) => {
          setRefundTarget(subscription)
          setIsRefundOpen(true)
          if (selectedId !== subscription.id) {
            void loadDetails(subscription.id)
          }
        }}
      />

      <div className="flex items-center justify-between text-sm text-slate-600">
        <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>Previous</button>
        <span>Page {page} of {pageCount}</span>
        <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50" disabled={page >= pageCount} onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}>Next</button>
      </div>

      {detailsLoading ? <p className="text-sm text-slate-500">Loading subscription details…</p> : null}

      {currentSubscription ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-1">
            <h2 className="text-lg font-medium text-slate-900">Subscription details</h2>
            <dl className="mt-3 space-y-1 text-sm text-slate-700">
              <div><dt className="inline text-slate-500">Email:</dt> <dd className="inline">{currentSubscription.email}</dd></div>
              <div><dt className="inline text-slate-500">Status:</dt> <dd className="inline capitalize">{currentSubscription.status}</dd></div>
              <div><dt className="inline text-slate-500">Plan:</dt> <dd className="inline capitalize">{currentSubscription.plan}</dd></div>
              <div><dt className="inline text-slate-500">Started:</dt> <dd className="inline">{dateLabel(currentSubscription.startedAt)}</dd></div>
              <div><dt className="inline text-slate-500">Renewal:</dt> <dd className="inline">{dateLabel(currentSubscription.renewalDate)}</dd></div>
              <div><dt className="inline text-slate-500">Next billing:</dt> <dd className="inline">{dateLabel(currentSubscription.nextBillingDate)}</dd></div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-1">
            <h2 className="text-lg font-medium text-slate-900">Full payment history</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(selectedDetails.transactions || []).map((item) => (
                <li key={item.id} className="rounded border border-slate-100 p-2">
                  {dateLabel(item.billedAt)} · {item.transactionId || item.invoiceNumber || item.id} · {formatCurrency(item.amountCents)} · {item.status}
                </li>
              ))}
              {!selectedDetails.transactions?.length ? <li className="text-slate-500">No transactions found.</li> : null}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-1">
            <h2 className="text-lg font-medium text-slate-900">Refund audit trail</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(selectedDetails.refundAuditTrail || []).map((item) => (
                <li key={item.id} className="rounded border border-slate-100 p-2">
                  {dateLabel(item.createdAt)} · {item.reason} · {formatCurrency(item.amountCents)} · admin: {item.adminId}
                </li>
              ))}
              {!selectedDetails.refundAuditTrail?.length ? <li className="text-slate-500">No refunds issued.</li> : null}
            </ul>
          </section>
        </div>
      ) : null}

      <RefundModal
        isOpen={isRefundOpen}
        subscription={refundTarget}
        details={selectedId === refundTarget?.id ? selectedDetails : null}
        adminId={adminId}
        onClose={() => setIsRefundOpen(false)}
        onSuccess={(payload) => {
          const message = payload?.message || 'Refund issued successfully.'
          window.alert(`${message} Customer notification email sent by payment provider.`)
          void refreshSubscriptions()
          if (refundTarget) {
            void loadDetails(refundTarget.id)
          }
        }}
      />
    </div>
  )
}
