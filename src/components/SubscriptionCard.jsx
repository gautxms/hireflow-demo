import API_BASE from '../config/api'
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

  const status = subscription?.status || user?.subscription_status || 'inactive'
  const plan = subscription?.plan || user?.subscription_plan || 'N/A'
  const startedAt = subscription?.started_date || user?.subscription_started_at || null
  const hasSubscription = Boolean(subscription || user?.subscription_plan || user?.subscription_status === 'active' || user?.subscription_status === 'trialing')
  const statusClass = ['active', 'trialing', 'cancelled', 'past_due', 'inactive'].includes(status) ? status : 'inactive'

  return (
    <div className="hf-account-card">
      <h2 className="hf-account-card__title">
        <span className="hf-account-card__icon">📦</span>
        Subscription
      </h2>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label hf-account-card__label--status">Status</p>
        <span className={`hf-account-card__status-badge hf-account-card__status-badge--${statusClass} ${status === 'active' ? 'hf-account-card__status-badge--active-text' : 'hf-account-card__status-badge--default-text'}`}>
          {status}
        </span>
      </div>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label">Plan</p>
        <p className="hf-account-card__value hf-account-card__value--capitalize">{plan || 'N/A'}</p>
      </div>

      <div className="hf-account-card__section hf-account-card__section--last">
        <p className="hf-account-card__label">Started</p>
        <p className="hf-account-card__value">
          {startedAt
            ? new Date(startedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : 'N/A'}
        </p>
      </div>

      {hasSubscription && status === 'active' && (
        <button className="hf-btn subscription-card__cta subscription-card__cta--cancel" onClick={handleCancelSubscription}>
          Cancel Subscription
        </button>
      )}

      {status === 'cancelled' && (
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
