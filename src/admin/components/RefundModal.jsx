import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'

const REFUND_REASONS = [
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'dispute', label: 'Dispute' },
  { value: 'other', label: 'Other' },
]

const WINDOW_DAYS = 30

function asMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

export default function RefundModal({ isOpen, subscription, details, adminId, onClose, onSuccess }) {
  const [reason, setReason] = useState('cancellation')
  const [amountCents, setAmountCents] = useState(0)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const latestTransaction = details?.transactions?.[0] || null
  const billedAt = latestTransaction?.billedAt || subscription?.latestBilledAt || null
  const billedAmountCents = latestTransaction?.amountCents || subscription?.latestAmountCents || 0

  useEffect(() => {
    setReason('cancellation')
    setConfirmChecked(false)
    setError('')
    setAmountCents(billedAmountCents)
  }, [subscription?.id, billedAmountCents])

  const ageDays = useMemo(() => {
    if (!billedAt) return null
    const ageMs = Date.now() - new Date(billedAt).getTime()
    return Math.floor(ageMs / (1000 * 60 * 60 * 24))
  }, [billedAt])

  const outsidePolicy = ageDays !== null && ageDays > WINDOW_DAYS

  if (!isOpen || !subscription) {
    return null
  }

  const submit = async () => {
    try {
      setSubmitting(true)
      setError('')
      const response = await fetch(`${API_BASE}/admin/subscriptions/${subscription.id}/refund`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          amountCents: Number(amountCents),
          transactionId: latestTransaction?.transactionId || null,
          adminId,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to issue refund')
      }

      onSuccess(payload)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label="Issue refund">
      <div className="ui-card ui-card--card-spacing ui-modal__dialog w-full max-w-lg">
        <h2 className="text-xl font-semibold text-slate-900">Issue refund</h2>
        <p className="mt-1 text-sm text-slate-600">{subscription.email} · {subscription.plan} plan</p>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Reason</span>
            <select className="ui-input w-full" value={reason} onChange={(event) => setReason(event.target.value)}>
              {REFUND_REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Amount (cents)</span>
            <input
              type="number"
              min={1}
              max={billedAmountCents || undefined}
              className="ui-input w-full"
              value={amountCents}
              onChange={(event) => setAmountCents(Number(event.target.value || 0))}
            />
            <span className="mt-1 block text-xs text-slate-500">{asMoney(amountCents)}</span>
          </label>

          <p className={`admin-inline-alert ${outsidePolicy ? 'admin-inline-alert--error' : 'admin-inline-alert--warning'} text-xs`}>
            Refund policy: transaction must be within {WINDOW_DAYS} days. {ageDays === null ? 'Transaction date unavailable.' : `Current age: ${ageDays} days.`}
          </p>

          {outsidePolicy ? (
            <p className="admin-inline-alert admin-inline-alert--error">Warning: this refund is outside policy and will be rejected.</p>
          ) : null}

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={confirmChecked} onChange={(event) => setConfirmChecked(event.target.checked)} />
            I confirm I reviewed the customer history and want to issue this refund.
          </label>

          {error ? <p className="admin-inline-alert admin-inline-alert--error">{error}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="ui-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="ui-btn ui-btn--primary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={submitting || outsidePolicy || !confirmChecked || !reason || !amountCents || !adminId}
            onClick={submit}
          >
            {submitting ? 'Submitting…' : 'Confirm refund'}
          </button>
        </div>
      </div>
    </div>
  )
}
