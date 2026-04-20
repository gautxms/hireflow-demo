import { useEffect, useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'
import API_BASE from '../config/api'
import '../styles/billing.css'
import '../styles/checkout.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

const CANCEL_REASONS = [
  'Too expensive',
  'Missing key feature',
  'Temporary pause',
  'Switching to competitor',
]

function Modal({ title, children, onClose }) {
  return (
    <div className="billing-modal">
      <div className="billing-modal__card">
        <div className="billing-modal__header">
          <h3 className="billing-modal__title">{title}</h3>
          <button type="button" onClick={onClose} className="billing-modal__close hf-btn hf-btn--secondary">✕</button>
        </div>
        <div className="billing-modal__body">{children}</div>
      </div>
    </div>
  )
}

export default function BillingPage() {
  const [subscription, setSubscription] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [targetPlan, setTargetPlan] = useState('monthly')
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0])

  usePageSeo('Billing & Subscription', 'Manage your subscription, invoices, and billing settings.')

  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  async function loadBilling() {
    if (!token) {
      setError('Please login to manage billing.')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const [subRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/subscriptions/current`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/subscriptions/history`, { headers: { Authorization: `Bearer ${token}` } }),
      ])

      const subPayload = await subRes.json()
      const historyPayload = await historyRes.json()

      if (!subRes.ok) {
        throw new Error(subPayload.error || 'Failed to load current subscription')
      }

      if (!historyRes.ok) {
        throw new Error(historyPayload.error || 'Failed to load invoice history')
      }

      setSubscription(subPayload.subscription)
      setHistory(historyPayload.invoices || [])
    } catch (fetchError) {
      setError(fetchError.message || 'Unable to load billing details')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBilling()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchingLabel = useMemo(() => {
    if (!subscription) return ''
    return targetPlan === 'annual' ? 'Upgrade to annual (prorated)' : 'Downgrade to monthly'
  }, [subscription, targetPlan])

  async function changePlan() {
    const response = await fetch(`${API_BASE}/subscriptions/change-plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetPlan }),
    })

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to update plan')
    }

    setPlanModalOpen(false)
    await loadBilling()
  }

  async function cancelSubscription() {
    const response = await fetch(`${API_BASE}/subscriptions/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason: cancelReason, acceptOffer: false }),
    })

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to cancel subscription')
    }

    setCancelModalOpen(false)
    await loadBilling()
  }

  async function downloadInvoice(invoiceId) {
    const response = await fetch(`${API_BASE}/subscriptions/invoices/${invoiceId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'Unable to download invoice')
    }

    const blob = await response.blob()
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `invoice-${invoiceId}.pdf`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  if (loading) {
    return (
      <main className="route-state billing-page">
        <div className="route-state-card">
          <h1 className="route-state-card__title">Loading billing dashboard…</h1>
        </div>
      </main>
    )
  }

  return (
    <main className="billing-page">
      <section className="billing-page__section">
        <BackButton />
        <h1 className="billing-page__title">Subscription Management</h1>
        <p className="billing-page__subtitle">View plans, upcoming charges, and invoice history.</p>

        {error ? <p className="billing-page__error">{error}</p> : null}

        {subscription ? (
          <>
            <article className="billing-page__card">
              <h2 className="billing-page__plan-title">Current Plan</h2>
              <p className="billing-page__line"><strong>{subscription.planLabel}</strong> — {subscription.costFormatted}</p>
              <p className="billing-page__meta">Renewal date: {subscription.renewalDate ? new Date(subscription.renewalDate).toLocaleDateString() : '—'}</p>
              <p className="billing-page__meta">Next billing: {subscription.nextBillingDate ? new Date(subscription.nextBillingDate).toLocaleDateString() : '—'}</p>
              <p className="billing-page__meta">Payment method: {subscription.paymentMethod}</p>
              <p className="billing-page__meta">Status: {subscription.status}</p>

              <div className="billing-page__actions">
                <button type="button" className="hf-btn hf-btn--primary" onClick={() => { setTargetPlan(subscription.plan === 'monthly' ? 'annual' : 'monthly'); setPlanModalOpen(true) }}>
                  {subscription.plan === 'monthly' ? 'Upgrade to annual' : 'Downgrade to monthly'}
                </button>
                <button type="button" className="hf-btn hf-btn--destructive" onClick={() => setCancelModalOpen(true)} disabled={subscription.status === 'cancelled'}>
                  Cancel subscription
                </button>
              </div>
            </article>

            <article className="billing-page__card">
              <h2 className="billing-page__history-title">Billing History (past 12 months)</h2>
              <table className="billing-page__table">
                <thead>
                  <tr>
                    <th className="billing-page__table-head">Date</th>
                    <th className="billing-page__table-head">Amount</th>
                    <th className="billing-page__table-head">Status</th>
                    <th className="billing-page__table-head">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={4} className="billing-page__table-cell--empty">No invoices yet.</td></tr>
                  ) : history.map((row) => (
                    <tr key={row.id}>
                      <td className="billing-page__table-cell--pad">{new Date(row.date).toLocaleDateString()}</td>
                      <td>{row.amountFormatted}</td>
                      <td>{row.status}</td>
                      <td>
                        <button type="button" className="hf-btn hf-btn--secondary" onClick={() => downloadInvoice(row.id)} disabled={!row.canDownload}>Download PDF</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </>
        ) : null}
      </section>

      {planModalOpen ? (
        <Modal title="Confirm plan change" onClose={() => setPlanModalOpen(false)}>
          <p>{switchingLabel}</p>
          <p className="billing-modal__muted">
            Upgrades apply prorated credits immediately. Downgrades take effect at the next billing date.
          </p>
          <div className="billing-modal__actions">
            <button type="button" className="hf-btn hf-btn--primary" onClick={changePlan}>Confirm</button>
          </div>
        </Modal>
      ) : null}

      {cancelModalOpen ? (
        <Modal title="Cancel subscription" onClose={() => setCancelModalOpen(false)}>
          <p>If you cancel, access remains active through the end of your current billing period.</p>
          <p className="billing-modal__muted">Before you go: Contact support for a retention discount.</p>
          <label htmlFor="cancel-reason">Reason</label>
          <select id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="billing-modal__select">
            {CANCEL_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
          <div className="billing-modal__actions">
            <button type="button" className="hf-btn hf-btn--destructive" onClick={cancelSubscription}>Confirm cancellation</button>
          </div>
        </Modal>
      ) : null}
    </main>
  )
}
