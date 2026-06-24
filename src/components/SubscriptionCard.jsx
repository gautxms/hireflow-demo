import { Package } from 'lucide-react'
import API_BASE from '../config/api'
import { resolveSubscriptionState } from '../utils/subscriptionState'
import './accountCards.css'

export default function SubscriptionCard({ user, token, onRefresh, subscription }) {

  const handleCancelSubscription = async () => {
    if (!window.confirm('Cancel subscription? You\'ll lose access after the current period.')) return

    try {
      const response = await fetch(`${API_BASE}/subscriptions/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'Cancelled from account page', acceptOffer: false }),
      })

      if (!response.ok) {
        throw new Error('Failed to cancel subscription')
      }

      onRefresh?.()
    } catch (error) {
      console.error('Failed to cancel subscription', error)
    }
  }

  const subscriptionState = resolveSubscriptionState({ user, subscription })
  const status = subscriptionState.rawStatus
  const plan = subscriptionState.planLabel
  const startedAt = subscription?.started_date || user?.subscription_started_at || null
  const statusClass = ['active', 'trialing', 'cancelled', 'canceled', 'past_due', 'paused', 'inactive'].includes(status) ? (status === 'canceled' ? 'cancelled' : status) : 'inactive'

  return (
    <div className="hf-account-card">
      <h2 className="hf-account-card__title">
        <Package size={18} strokeWidth={1.5} className="hf-account-card__icon" />
        Subscription
      </h2>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label hf-account-card__label--status">Status</p>
        <span className={`hf-account-card__status-badge hf-account-card__status-badge--${statusClass} ${status === 'active' ? 'hf-account-card__status-badge--active-text' : 'hf-account-card__status-badge--default-text'}`}>
          {subscriptionState.statusLabel}
        </span>
      </div>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label">Plan</p>
        <p className="hf-account-card__value">{plan}</p>
      </div>

      {!subscriptionState.isFree && startedAt ? (
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
        <p className="hf-billing-card__description">Upgrade to unlock resume analysis, candidate ranking, shortlists, and hiring reports.</p>
      )}

      {subscriptionState.canManageBilling && status === 'active' && (
        <button className="hf-btn subscription-card__cta subscription-card__cta--cancel" onClick={handleCancelSubscription}>
          Cancel Subscription
        </button>
      )}

      {subscriptionState.isCanceled && (
        <button
          className="hf-btn subscription-card__cta subscription-card__cta--primary"
          onClick={() => {
            window.location.href = '/checkout'
          }}
        >
          Reactivate Subscription
        </button>
      )}
    </div>
  )
}
