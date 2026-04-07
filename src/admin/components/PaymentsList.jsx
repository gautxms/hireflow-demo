function formatCurrency(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function PaymentsList({ failedPayments, retryingId, onRetry }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-lg font-medium text-amber-900">Failed payments</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {(failedPayments || []).map((payment) => (
          <li key={payment.id} className="rounded border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                <strong>{payment.transactionId}</strong> · {payment.customerEmail || 'Unknown customer'} · {formatCurrency(payment.amount)} · {payment.status}
              </p>
              <button
                type="button"
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => onRetry(payment.transactionId)}
                disabled={retryingId === payment.transactionId}
              >
                {retryingId === payment.transactionId ? 'Retrying…' : 'Retry payment'}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600">Last error: {payment.lastError || 'n/a'} · Next retry: {formatDate(payment.nextRetryAt)}</p>
          </li>
        ))}
        {!failedPayments?.length ? <li className="text-slate-600">No failed payments found.</li> : null}
      </ul>
    </div>
  )
}
