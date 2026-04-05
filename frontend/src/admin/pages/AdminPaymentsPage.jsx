import { useEffect, useState } from 'react'

function money(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

function day(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function AdminPaymentsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState({ transactions: [], failedPayments: [], revenueSummary: null, auditTrail: [] })

  const loadPayments = async () => {
    try {
      setLoading(true)
      setError('')
      const response = await fetch('/api/admin/payments', { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to load payments')
      const payload = await response.json()
      setData(payload)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPayments()
  }, [])

  const retryPayment = async (transactionId) => {
    const response = await fetch(`/api/admin/payments/${transactionId}/retry`, {
      method: 'POST',
      credentials: 'include',
    })

    const payload = await response.json()
    if (!response.ok) {
      window.alert(payload.error || 'Retry failed')
      return
    }

    window.alert(payload.message || 'Retry sent')
    void loadPayments()
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin Payment Management</h1>

      {data.revenueSummary ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">MRR: <strong>${Number(data.revenueSummary.mrr || 0).toFixed(2)}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">ARR: <strong>${Number(data.revenueSummary.arr || 0).toFixed(2)}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">Churn: <strong>{Number(data.revenueSummary.churnRate || 0).toFixed(2)}%</strong></div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-lg font-medium text-amber-900">Failed Payments</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(data.failedPayments || []).map((attempt) => (
            <li key={attempt.id} className="rounded border border-amber-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <strong>{attempt.transactionId}</strong> · {attempt.customerEmail || 'Unknown'} · {money(attempt.amount)} · {attempt.status}
                </p>
                <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-white" onClick={() => retryPayment(attempt.transactionId)}>
                  Retry
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-600">Last error: {attempt.lastError || 'n/a'} · Next retry: {day(attempt.nextRetryAt)}</p>
            </li>
          ))}
          {!data.failedPayments?.length ? <li className="text-slate-600">No failed payments.</li> : null}
        </ul>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-200 px-4 py-3 text-lg font-medium">All Transactions</h2>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">Transaction</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Billed At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-3 text-slate-500">Loading…</td></tr>
            ) : (data.transactions || []).map((tx) => (
              <tr key={tx.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{tx.transactionId || tx.invoiceNumber || tx.id}</td>
                <td className="px-4 py-3">{tx.email || '—'}</td>
                <td className="px-4 py-3">{tx.status}</td>
                <td className="px-4 py-3">{money(tx.amountCents)}</td>
                <td className="px-4 py-3">{day(tx.billedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-medium text-slate-900">Payment Audit Trail (Refunds)</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(data.auditTrail || []).map((item) => (
            <li key={item.id} className="rounded border border-slate-100 p-2">
              {day(item.createdAt)} · tx: {item.transactionId} · {item.reason} · {money(item.amountCents)} · admin: {item.adminId}
            </li>
          ))}
          {!data.auditTrail?.length ? <li className="text-slate-500">No refund audit events found.</li> : null}
        </ul>
      </div>
    </div>
  )
}
