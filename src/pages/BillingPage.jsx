import { useEffect, useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'
import StatePattern from '../components/state/StatePattern'
import API_BASE from '../config/api'
import { canRenderBillingPage, resolveSubscriptionState } from '../utils/subscriptionState'
import '../styles/billing.css'
import '../styles/checkout.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—'
}

const CANCEL_REASONS = [
  'Too expensive',
  'Missing key feature',
  'Temporary pause',
  'Switching to competitor',
]

function Modal({ title, children, onClose, isPending = false }) {
  return (
    <div className="billing-modal" role="presentation">
      <div className="billing-modal__card" role="dialog" aria-modal="true" aria-labelledby="billing-modal-title">
        <div className="billing-modal__header">
          <h3 id="billing-modal-title" className="billing-modal__title">{title}</h3>
          <button type="button" onClick={onClose} className="billing-modal__close hf-btn hf-btn--secondary" disabled={isPending}>Close</button>
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
  const [actionFeedback, setActionFeedback] = useState({ type: '', message: '' })
  const [isChangingPlan, setIsChangingPlan] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

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
      setError('')
      const subRes = await fetch(`${API_BASE}/subscriptions/current`, { headers: { Authorization: `Bearer ${token}` } })
      const subPayload = await subRes.json().catch(() => ({}))

      if (!subRes.ok) {
        throw new Error(subPayload.error || 'Failed to load current subscription')
      }

      const nextSubscription = subPayload.subscription || null
      setSubscription(nextSubscription)

      const subscriptionState = resolveSubscriptionState({ subscription: nextSubscription })
      if (!canRenderBillingPage(subscriptionState)) {
        window.location.replace('/account?section=billing')
        return
      }

      if (!subscriptionState.canManageBilling) {
        setHistory([])
        return
      }

      const historyRes = await fetch(`${API_BASE}/subscriptions/history`, { headers: { Authorization: `Bearer ${token}` } })
      const historyPayload = await historyRes.json().catch(() => ({}))

      if (!historyRes.ok) {
        throw new Error(historyPayload.error || 'Failed to load invoice history')
      }

      setHistory(historyPayload.invoices || [])
    } catch {
      setError('We could not open billing management right now. Please try again or contact support if this continues.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBilling()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subscriptionState = resolveSubscriptionState({ subscription })
  const canShowBillingPage = canRenderBillingPage(subscriptionState)

  const switchingLabel = useMemo(() => {
    if (!subscription) return ''
    return targetPlan === 'annual' ? 'Upgrade to annual (prorated)' : 'Downgrade to monthly'
  }, [subscription, targetPlan])

  async function changePlan() {
    if (isChangingPlan) return

    try {
      setIsChangingPlan(true)
      setActionFeedback({ type: '', message: '' })
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
      setActionFeedback({ type: 'success', message: payload.message || 'Plan updated successfully.' })
      await loadBilling()
    } catch (err) {
      setActionFeedback({ type: 'error', message: err.message || 'Unable to update plan' })
    } finally {
      setIsChangingPlan(false)
    }
  }

  async function cancelSubscription() {
    if (isCancelling) return

    try {
      setIsCancelling(true)
      setActionFeedback({ type: '', message: '' })
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
      setActionFeedback({ type: 'success', message: payload.message || 'Subscription cancellation confirmed.' })
      await loadBilling()
    } catch (err) {
      setActionFeedback({ type: 'error', message: err.message || 'Unable to cancel subscription' })
    } finally {
      setIsCancelling(false)
    }
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
        <StatePattern
          kind="loading"
          title="Loading billing dashboard…"
          description="Fetching your subscription, payment method, and invoice history."
        />
      </main>
    )
  }

  if (!error && !loading && !canShowBillingPage) {
    return null
  }

  return (
    <main className="billing-page">
      <section className="billing-page__section">
        <BackButton />
        <h1 className="billing-page__title">Account & Plan</h1>
        <p className="billing-page__subtitle">View your subscription, billing access, and plan options.</p>

        {error ? <StatePattern kind="error" compact title="We could not open billing management right now" description={error} action={(<button type="button" className="route-state-card__action" onClick={loadBilling}>Retry</button>)} /> : null}

        {!error && subscription && canShowBillingPage ? (
          <>
            <article className="billing-page__card">
              <div className="billing-page__card-header">
                <div>
                  <p className="billing-page__eyebrow">Current Plan</p>
                  <h2 className="billing-page__plan-title">{subscription.planLabel || subscriptionState.planLabel}</h2>
                </div>
                <span className="billing-page__status-badge">{subscriptionState.statusLabel}</span>
              </div>
              <p className="billing-page__line">{subscription.costFormatted || '—'} <span>{subscription.plan ? `per ${subscription.plan === 'annual' ? 'year' : 'month'}` : ''}</span></p>
              <div className="billing-page__meta-grid">
                <p className="billing-page__meta"><span>Renewal date</span>{formatDate(subscription.renewalDate)}</p>
                <p className="billing-page__meta"><span>Next billing</span>{formatDate(subscription.nextBillingDate)}</p>
                <p className="billing-page__meta"><span>Payment method</span>{subscription.paymentMethod || 'Managed securely in Paddle'}</p>
                <p className="billing-page__meta"><span>Cancellation effective</span>{formatDate(subscription.cancellationEffectiveAt)}</p>
              </div>
              {actionFeedback.message ? <p className={`billing-page__feedback billing-page__feedback--${actionFeedback.type}`} role={actionFeedback.type === 'error' ? 'alert' : 'status'}>{actionFeedback.message}</p> : null}

              {subscriptionState.canManageBilling ? (
                <div className="billing-page__actions">
                  <button type="button" className="hf-btn hf-btn--primary" onClick={() => { setActionFeedback({ type: '', message: '' }); setTargetPlan(subscription.plan === 'monthly' ? 'annual' : 'monthly'); setPlanModalOpen(true) }}>
                    {subscription.plan === 'monthly' ? 'Upgrade to annual' : 'Downgrade to monthly'}
                  </button>
                  <button type="button" className="hf-btn hf-btn--destructive" onClick={() => { setActionFeedback({ type: '', message: '' }); setCancelModalOpen(true) }} disabled={subscriptionState.isCanceled}>
                    Cancel subscription
                  </button>
                </div>
              ) : null}
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
                    <tr><td colSpan={4} className="billing-page__table-cell--empty"><StatePattern kind="empty" compact title="No invoices yet" description="Invoices will appear after your first successful billing cycle." /></td></tr>
                  ) : history.map((row) => (
                    <tr key={row.id}>
                      <td className="billing-page__table-cell--pad" data-label="Date">{formatDate(row.date)}</td>
                      <td className="billing-page__table-cell--pad" data-label="Amount">{row.amountFormatted}</td>
                      <td className="billing-page__table-cell--pad" data-label="Status"><span className="billing-page__invoice-status">{row.status}</span></td>
                      <td className="billing-page__table-cell--pad" data-label="Invoice">
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
        <Modal title="Confirm plan change" onClose={() => setPlanModalOpen(false)} isPending={isChangingPlan}>
          <p>{switchingLabel}</p>
          <p className="billing-modal__muted">
            Upgrades apply prorated credits immediately. Downgrades take effect at the next billing date.
          </p>
          <div className="billing-modal__actions">
            <button type="button" className="hf-btn hf-btn--primary" onClick={changePlan} disabled={isChangingPlan}>{isChangingPlan ? 'Updating plan…' : 'Confirm'}</button>
          </div>
        </Modal>
      ) : null}

      {cancelModalOpen ? (
        <Modal title="Cancel subscription" onClose={() => setCancelModalOpen(false)} isPending={isCancelling}>
          <p>If you cancel, access remains active through the end of your current billing period.</p>
          <p className="billing-modal__muted">Before you go: Contact support for a retention discount.</p>
          <label htmlFor="cancel-reason">Reason</label>
          <select id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="billing-modal__select" disabled={isCancelling}>
            {CANCEL_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
          <div className="billing-modal__actions">
            <button type="button" className="hf-btn hf-btn--destructive" onClick={cancelSubscription} disabled={isCancelling}>{isCancelling ? 'Cancelling…' : 'Confirm cancellation'}</button>
          </div>
        </Modal>
      ) : null}
    </main>
  )
}
