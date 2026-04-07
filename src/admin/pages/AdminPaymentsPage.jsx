import { useEffect, useState } from 'react'
import PaymentsList from '../components/PaymentsList'

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
  const [error, setError] = useState('')
  const [retryingId, setRetryingId] = useState('')
  const [data, setData] = useState({ transactions: [], failedPayments: [], revenueSummary: null, auditTrail: [] })

  const loadData = async () => {
    try {
      setLoading(true)
      setError('')
      const response = await fetch('/api/admin/payments', { credentials: 'include' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load payment admin data')
      }

      setData(payload)
    } catch (err) {
      setError(err.message)
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
      const response = await fetch(`/api/admin/payments/${transactionId}/retry`, {
        method: 'POST',
        credentials: 'include',
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Retry failed')
      }

      window.alert(`${payload.message || 'Retry sent.'} Customer reminder email has been queued.`)
      await loadData()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setRetryingId('')
    }
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin payments & revenue</h1>

      {data.revenueSummary ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">MRR: <strong>{moneyFromDollars(data.revenueSummary.mrr)}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">ARR: <strong>{moneyFromDollars(data.revenueSummary.arr)}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">Churn: <strong>{Number(data.revenueSummary.churnRate || 0).toFixed(2)}%</strong></div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <PaymentsList failedPayments={data.failedPayments} retryingId={retryingId} onRetry={retryFailedPayment} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-200 px-4 py-3 text-lg font-medium">Transactions</h2>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">Transaction</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Billed at</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="px-4 py-3 text-slate-500" colSpan={5}>Loading transactions…</td></tr> : null}
            {!loading && (data.transactions || []).map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{item.transactionId || item.invoiceNumber || item.id}</td>
                <td className="px-4 py-3">{item.email || '—'}</td>
                <td className="px-4 py-3 capitalize">{item.status || '—'}</td>
                <td className="px-4 py-3">{money(item.amountCents)}</td>
                <td className="px-4 py-3">{dateLabel(item.billedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-medium text-slate-900">Refund history</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(data.auditTrail || []).map((item) => (
            <li key={item.id} className="rounded border border-slate-100 p-2">
              {dateLabel(item.createdAt)} · tx: {item.transactionId} · {item.reason} · {money(item.amountCents)} · admin: {item.adminId}
            </li>
          ))}
          {!data.auditTrail?.length ? <li className="text-slate-500">No refund events found.</li> : null}
        </ul>
      </section>
    </div>
  )
}
