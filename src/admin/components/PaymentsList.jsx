import { EmptyState } from './WidgetState'

function formatCurrency(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

export default function PaymentsList({ failedPayments }) {
  return (
    <div className="admin-inline-alert admin-inline-alert--warning p-4">
      <h2 className="text-lg font-medium">Failed payments</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {(failedPayments || []).map((payment) => (
          <li key={payment.id} className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p><strong>{payment.transactionId}</strong> · {payment.customerEmail || 'Unknown customer'} · {formatCurrency(payment.amount)} · {payment.status}</p>
            </div>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Paddle manages collection retries. HireFlow updates this record after authoritative provider confirmation.</p>
          </li>
        ))}
        {!failedPayments?.length ? <li><EmptyState title="No failed payments" description="There are no recoverable failures right now." /></li> : null}
      </ul>
    </div>
  )
}
