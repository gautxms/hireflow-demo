import { useEffect, useState } from 'react'
import PaymentsList from '../components/PaymentsList'
import StateAlert from '../components/StateAlert'
import { EmptyState, TableSkeleton } from '../components/WidgetState'
import API_BASE from '../../config/api'
import { adminFetchJson, getMappedError } from '../utils/adminErrorState'

function money(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

function moneyFromDollars(amount = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0)
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function AdminPaymentsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [retryingId, setRetryingId] = useState('')
  const [data, setData] = useState({ transactions: [], failedPayments: [], revenueSummary: null, auditTrail: [] })

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const payload = await adminFetchJson(`${API_BASE}/admin/payments`, 'Failed to load payment admin data')
      setData(payload)
    } catch (err) {
      setError(getMappedError(err, 'Payments data could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const retryFailedPayment = async (transactionId) => {
    try {
      setRetryingId(transactionId)
      const response = await fetch(`${API_BASE}/admin/payments/${transactionId}/retry`, { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Retry failed')
      await loadData()
    } finally {
      setRetryingId('')
    }
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin payments & revenue</h1>
      {error ? <StateAlert state={error} onRetry={() => void loadData()} /> : null}

      {data.revenueSummary ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">MRR: <strong>{moneyFromDollars(data.revenueSummary.mrr)}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">ARR: <strong>{moneyFromDollars(data.revenueSummary.arr)}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">Churn: <strong>{Number(data.revenueSummary.churnRate || 0).toFixed(2)}%</strong></div>
        </div>
      ) : null}

      <PaymentsList failedPayments={data.failedPayments} retryingId={retryingId} onRetry={retryFailedPayment} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-200 px-4 py-3 text-lg font-medium">Transactions</h2>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-4 py-3">Transaction</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Billed at</th></tr></thead>
          {loading ? <TableSkeleton columns={5} rows={5} /> : (
            <tbody>
              {(data.transactions || []).map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="px-4 py-3">{item.transactionId || item.invoiceNumber || item.id}</td><td className="px-4 py-3">{item.email || '—'}</td><td className="px-4 py-3 capitalize">{item.status || '—'}</td><td className="px-4 py-3">{money(item.amountCents)}</td><td className="px-4 py-3">{dateLabel(item.billedAt)}</td></tr>)}
              {!data.transactions?.length ? <tr><td className="p-4" colSpan={5}><EmptyState title="No transactions" description="No transaction records are available for this range." /></td></tr> : null}
            </tbody>
          )}
        </table>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-medium text-slate-900">Refund history</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(data.auditTrail || []).map((item) => <li key={item.id} className="rounded border border-slate-100 p-2">{dateLabel(item.createdAt)} · tx: {item.transactionId} · {item.reason} · {money(item.amountCents)} · admin: {item.adminId}</li>)}
          {!data.auditTrail?.length ? <li><EmptyState title="No refund events" description="No refunds have been recorded yet." /></li> : null}
        </ul>
      </section>
    </div>
  )
}
