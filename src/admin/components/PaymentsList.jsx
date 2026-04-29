import { EmptyState } from './WidgetState'

function formatCurrency(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function PaymentsList({ failedPayments, retryingId, onRetry }) {
  return (
    <div className="admin-inline-alert admin-inline-alert--warning p-4">
      <h2 className="text-lg font-medium">Failed payments</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {(failedPayments || []).map((payment) => (
          <li key={payment.id} className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p><strong>{payment.transactionId}</strong> · {payment.customerEmail || 'Unknown customer'} · {formatCurrency(payment.amount)} · {payment.status}</p>
              <button type="button" className="ui-btn ui-btn--primary disabled:cursor-not-allowed disabled:opacity-50" onClick={() => onRetry(payment.transactionId)} disabled={retryingId === payment.transactionId}>
                {retryingId === payment.transactionId ? 'Retrying…' : 'Retry payment'}
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Last attempt failed · Next retry: {formatDate(payment.nextRetryAt)}</p>
          </li>
        ))}
        {!failedPayments?.length ? <li><EmptyState title="No failed payments" description="There are no recoverable failures right now." /></li> : null}
      </ul>
    </div>
  )
}
