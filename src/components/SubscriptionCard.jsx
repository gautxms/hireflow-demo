import { Package } from 'lucide-react'
import { canRenderBillingPage, resolveSubscriptionState } from '../utils/subscriptionState'
import './accountCards.css'

function formatDate(value) {
  if (!value) return ''

  const parsedDate = new Date(value)
  if (Number.isNaN(parsedDate.getTime())) return ''

  return parsedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function SubscriptionCard({ user, subscription }) {
  const subscriptionState = resolveSubscriptionState({ user, subscription })
  const status = subscriptionState.rawStatus
  const plan = subscriptionState.planLabel
  const startedAt = subscription?.started_date || user?.subscription_started_at || null
  const statusClass = subscriptionState.isCancellationScheduled
    ? 'active'
    : ['active', 'trialing', 'cancelled', 'canceled', 'past_due', 'paused', 'inactive'].includes(status)
      ? (status === 'canceled' ? 'cancelled' : status)
      : 'inactive'
  const accessUntil = formatDate(subscriptionState.accessEndsAt || subscriptionState.paidThroughDate)
  const canOpenBilling = canRenderBillingPage(subscriptionState)
  const shouldViewPlans = subscriptionState.isFree || (!subscriptionState.hasProviderSubscription && !subscriptionState.hasActivePaidAccess && !subscriptionState.isPastDue && !subscriptionState.isPaused)
  const needsBillingSupport = !canOpenBilling && !shouldViewPlans
  const actionHref = canOpenBilling ? '/billing' : shouldViewPlans ? '/pricing' : '/help'
  const actionLabel = canOpenBilling ? 'Manage plan & billing' : shouldViewPlans ? 'View plans' : 'Contact support'

  return (
    <div className="hf-account-card">
      <h2 className="hf-account-card__title">
        <Package size={18} strokeWidth={1.5} className="hf-account-card__icon" />
        Subscription
      </h2>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label hf-account-card__label--status">Status</p>
        <span className={`hf-account-card__status-badge hf-account-card__status-badge--${statusClass} ${subscriptionState.isActive || subscriptionState.isCancellationScheduled ? 'hf-account-card__status-badge--active-text' : 'hf-account-card__status-badge--default-text'}`}>
          {subscriptionState.statusLabel}
        </span>
      </div>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label">Plan</p>
        <p className="hf-account-card__value">{plan}</p>
      </div>

      {needsBillingSupport ? (
        <p className="hf-billing-card__description">Billing setup needs attention. Contact support so we can safely manage this subscription.</p>
      ) : subscriptionState.isCancellationScheduled && accessUntil ? (
        <div className="hf-account-card__section hf-account-card__section--last">
          <p className="hf-account-card__label">Access until</p>
          <p className="hf-account-card__value">{accessUntil}</p>
        </div>
      ) : !subscriptionState.isFree && startedAt ? (
        <div className="hf-account-card__section hf-account-card__section--last">
          <p className="hf-account-card__label">Started</p>
          <p className="hf-account-card__value">
            {new Date(startedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
      ) : (
        <p className="hf-billing-card__description">Subscription required to unlock resume analysis, candidate ranking, shortlists, and hiring reports.</p>
      )}

      <button
        type="button"
        className="hf-btn subscription-card__cta subscription-card__cta--primary"
        onClick={() => {
          window.location.href = actionHref
        }}
      >
        {actionLabel}
      </button>
    </div>
  )
}
