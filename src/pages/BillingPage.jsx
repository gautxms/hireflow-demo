import { useEffect, useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'
import StatePattern from '../components/state/StatePattern'
import API_BASE from '../config/api'
import { canRenderBillingPage, resolveSubscriptionState } from '../utils/subscriptionState'
import { canShowCancelAction, getBillingPlanAction, getBillingStatusLabel, getCancelActionLabel, getCancellationAccessMessage, getCancellationSuccessMessage, hasScheduledCancellation, shouldRenderBillingHistory, shouldShowPlanActionSupportNote } from './billingPageActions'
import '../styles/billing.css'
import '../styles/checkout.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—'
}

function isRetryablePreviewError(code) {
  return code === 'PADDLE_SUBSCRIPTION_UPDATE_FAILED' || code === 'UNKNOWN'
}

function getSafeBillingMessage(payload, fallback = 'Unable to update plan') {
  const messages = {
    BILLING_CONFIG_MISSING: 'Billing is not configured for this plan change yet. Please contact support and mention missing Paddle price configuration.',
    BILLING_PROVIDER_MISSING: 'We could not find a Paddle subscription for your account. Please contact support so we can update your plan safely.',
    PAYMENT_FAILED_OR_ACTION_REQUIRED: 'Paddle could not apply this change because payment failed or needs action. Please update your payment method or contact support.',
    PADDLE_SUBSCRIPTION_UPDATE_FAILED: 'Paddle could not update your subscription right now. Please try again or contact support if this continues.',
    PLAN_ALREADY_ACTIVE: 'You are already on that plan.',
    PLAN_CHANGE_NOT_ALLOWED: 'This plan change is not available for your subscription. Please contact support.',
    UNSUPPORTED_BILLING_ITEMS: 'Your subscription has recurring add-ons that need support-assisted plan changes. Please contact support so we can update your plan safely.',
  }
  return messages[payload?.code] || payload?.error || fallback
}

const PLAN_CONFIG_LABELS = { monthly: 'Monthly', annual: 'Annual' }

const CANCEL_REASONS = [
  'Too expensive',
  'Missing key feature',
  'Temporary pause',
  'Switching to competitor',
]

function Modal({ title, children, onClose, isPending = false }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isPending, onClose])

  return (
    <div className="billing-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isPending) onClose() }}>
      <div className="billing-modal__card" role="dialog" aria-modal="true" aria-labelledby="billing-modal-title">
        <div className="billing-modal__header">
          <h3 id="billing-modal-title" className="billing-modal__title">{title}</h3>
          <button type="button" onClick={onClose} className="billing-modal__close hf-btn hf-btn--secondary" aria-label="Close dialog" disabled={isPending}>Close</button>
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
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [planPreview, setPlanPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [previewErrorCode, setPreviewErrorCode] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)

  const upgradeTestKey = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('upgradeTestKey') || ''
  }, [])

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
  const hasVerifiedPreviewAmounts = planPreview?.hasVerifiedPreviewAmounts === true
  const canConfirmPlanChange = !isChangingPlan && !isLoadingPreview && !previewError && hasVerifiedPreviewAmounts
  const planAction = getBillingPlanAction(subscription?.plan)
  const cancelActionLabel = getCancelActionLabel(subscription?.plan)
  const displayedStatusLabel = getBillingStatusLabel(subscriptionState, subscription, formatDate)
  const cancellationAccessMessage = getCancellationAccessMessage(subscriptionState, subscription, formatDate)
  const hasScheduledCancellationState = hasScheduledCancellation(subscriptionState, subscription)
  const shouldShowCancelAction = canShowCancelAction(subscriptionState, subscription)
  const shouldShowPlanSupportNote = shouldShowPlanActionSupportNote(planAction, subscriptionState, subscription)
  const nextBillingLabel = hasScheduledCancellationState ? 'No further billing' : formatDate(subscription?.nextBillingDate)
  const hasBillingHistory = shouldRenderBillingHistory(history)

  const switchingLabel = useMemo(() => {
    if (!subscription) return ''
    return targetPlan === 'annual' ? 'Upgrade to annual (prorated)' : 'Downgrade to monthly'
  }, [subscription, targetPlan])

  async function loadPlanPreview(nextPlan = targetPlan) {
    setPlanPreview(null)
    setPreviewError('')
    setPreviewErrorCode('')
    setIsLoadingPreview(true)

    try {
      const response = await fetch(`${API_BASE}/subscriptions/change-plan-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetPlan: nextPlan,
          ...(upgradeTestKey ? { upgradeTestKey } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setPreviewErrorCode(payload?.code || 'UNKNOWN')
        throw new Error(getSafeBillingMessage(payload, 'Unable to load plan change preview'))
      }
      setPlanPreview(payload)
    } catch (err) {
      setPreviewError(err.message || 'Unable to load plan change preview')
      setPreviewErrorCode((currentCode) => currentCode || 'UNKNOWN')
    } finally {
      setIsLoadingPreview(false)
    }
  }

  async function openPlanModal(nextPlan) {
    setActionFeedback({ type: '', message: '' })
    setTargetPlan(nextPlan)
    setPlanModalOpen(true)
    await loadPlanPreview(nextPlan)
  }

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
        body: JSON.stringify({
          targetPlan,
          ...(upgradeTestKey ? { upgradeTestKey } : {}),
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(getSafeBillingMessage(payload))
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
      setActionFeedback({ type: 'success', message: getCancellationSuccessMessage(subscription, payload, formatDate) })
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
                <span className="billing-page__status-badge">{displayedStatusLabel}</span>
              </div>
              <p className="billing-page__line">{subscription.costFormatted || '—'} <span>{subscription.billingInterval ? `per ${subscription.billingInterval}` : (subscription.plan ? `per ${subscription.plan === 'annual' ? 'year' : 'month'}` : '')}</span></p>
              {subscription.costSource === 'local_fallback' && subscription.paddleSubscriptionId ? (
                <p className="billing-page__cost-helper">Price shown from plan settings; Paddle is the source of truth.</p>
              ) : null}
              <div className="billing-page__meta-grid">
                <p className="billing-page__meta"><span>Renewal date</span>{formatDate(subscription.renewalDate)}</p>
                <p className="billing-page__meta"><span>Next billing</span>{nextBillingLabel}</p>
                <p className="billing-page__meta"><span>Payment method</span>{subscription.paymentMethod || 'Managed securely in Paddle'}</p>
                <p className="billing-page__meta"><span>Cancellation effective</span>{formatDate(subscription.cancellationEffectiveAt)}</p>
              </div>
              {cancellationAccessMessage ? (
                <>
                  <p className="billing-page__renewal-note">{cancellationAccessMessage}</p>
                  <p className="billing-page__support-note">Need to keep using HireFlow? Contact support to resume your subscription.</p>
                </>
              ) : null}
              {actionFeedback.message ? <p className={`billing-page__feedback billing-page__feedback--${actionFeedback.type}`} role={actionFeedback.type === 'error' ? 'alert' : 'status'}>{actionFeedback.message}</p> : null}

              {subscriptionState.canManageBilling ? (
                <div className="billing-page__actions">
                  {planAction?.isSelfServe ? (
                    <button type="button" className="hf-btn hf-btn--primary" onClick={() => openPlanModal(planAction.targetPlan)}>
                      {planAction.label}
                    </button>
                  ) : null}
                  {shouldShowPlanSupportNote ? (
                    <p className="billing-page__support-note">{planAction.label}</p>
                  ) : null}
                  {shouldShowCancelAction ? (
                    <button type="button" className="hf-btn hf-btn--destructive" onClick={() => { setActionFeedback({ type: '', message: '' }); setCancelModalOpen(true) }}>
                      {cancelActionLabel}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>

            {hasBillingHistory ? (
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
                    {history.map((row) => (
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
            ) : null}
          </>
        ) : null}
      </section>

      {planModalOpen ? (
        <Modal title="Confirm plan change" onClose={() => setPlanModalOpen(false)} isPending={isChangingPlan}>
          <p>{switchingLabel}</p>
          <div className="billing-modal__summary">
            <p><span>Current plan</span>{subscription?.planLabel || subscriptionState.planLabel}</p>
            <p><span>New plan</span>{PLAN_CONFIG_LABELS[targetPlan] || targetPlan}</p>
            <p><span>Immediate charge / credit</span>{isLoadingPreview ? 'Loading…' : (hasVerifiedPreviewAmounts ? planPreview?.immediateAmountFormatted : 'Unable to verify billing amount.')}</p>
            <p><span>Next billing</span>{isLoadingPreview ? 'Loading…' : (hasVerifiedPreviewAmounts ? `${planPreview?.nextBillingAmountFormatted} on ${formatDate(planPreview?.nextBillingDate || subscription?.nextBillingDate)}` : 'Unable to verify billing amount.')}</p>
            <p><span>Payment method</span>{subscription?.paymentMethod || planPreview?.paymentMethod || 'Card on file'}</p>
          </div>
          <p className="billing-modal__muted">
            Upgrades apply immediately with Paddle proration. Downgrades are scheduled for the next billing period, so your current plan remains visible until then.
          </p>
          {previewError ? (
            <div className="billing-modal__preview-error">
              <p className="billing-page__feedback billing-page__feedback--error" role="alert">{previewError}</p>
              {isRetryablePreviewError(previewErrorCode) ? (
                <button type="button" className="hf-btn hf-btn--secondary" onClick={() => loadPlanPreview(targetPlan)} disabled={isLoadingPreview || isChangingPlan}>
                  {isLoadingPreview ? 'Retrying preview…' : 'Retry preview'}
                </button>
              ) : null}
            </div>
          ) : null}
          {actionFeedback.type === 'error' && actionFeedback.message ? <p className="billing-page__feedback billing-page__feedback--error" role="alert">{actionFeedback.message}</p> : null}
          <div className="billing-modal__actions">
            <button type="button" className="hf-btn hf-btn--secondary" onClick={() => setPlanModalOpen(false)} disabled={isChangingPlan}>Close</button>
            <button type="button" className="hf-btn hf-btn--primary" onClick={changePlan} disabled={!canConfirmPlanChange}>{isChangingPlan ? 'Updating plan…' : 'Confirm'}</button>
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
