import { useMemo, useState } from 'react'

const REASONS = [
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'dispute', label: 'Dispute' },
  { value: 'other', label: 'Other' },
]

function formatMoney(cents = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format((Number(cents) || 0) / 100)
}

export default function RefundModal({ isOpen, subscription, adminId, onClose, onSuccess }) {
  const [reason, setReason] = useState('cancellation')
  const [amountCents, setAmountCents] = useState(subscription?.latestAmountCents || 0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const disableSubmit = useMemo(() => !reason || !amountCents || !adminId, [amountCents, reason, adminId])

  if (!isOpen || !subscription) {
    return null
  }

  const submitRefund = async () => {
    try {
      setIsSubmitting(true)
      setError('')

      const response = await fetch(`/api/admin/subscriptions/${subscription.id}/refund`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          amountCents: Number(amountCents),
          transactionId: subscription.latestTransactionId || null,
          adminId,
        }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Refund failed')
      }

      onSuccess(payload)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-slate-900">Issue Refund</h2>
        <p className="mt-1 text-sm text-slate-500">
          Subscription: {subscription.email} ({subscription.plan})
        </p>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Reason *</span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              {REASONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Amount (cents)</span>
            <input
              type="number"
              min={1}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={amountCents}
              onChange={(event) => setAmountCents(Number(event.target.value || 0))}
            />
            <span className="mt-1 block text-xs text-slate-500">{formatMoney(amountCents)}</span>
          </label>

          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Refund policy: refunds are only allowed for transactions billed within the past 30 days.
          </p>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="rounded-md border border-slate-300 px-4 py-2" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-indigo-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disableSubmit || isSubmitting}
            onClick={submitRefund}
          >
            {isSubmitting ? 'Issuing…' : 'Confirm Refund'}
          </button>
        </div>
      </div>
    </div>
  )
}
