import { CreditCard } from 'lucide-react'
import { resolveSubscriptionState } from '../utils/subscriptionState'
import './accountCards.css'


function formatDate(value) {
  if (!value) return 'N/A'

  const parsedDate = new Date(value)
  if (Number.isNaN(parsedDate.getTime())) {
    return 'N/A'
  }

  return parsedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function BillingCard({ user, subscription }) {
  const billingState = resolveSubscriptionState({ user, subscription })
  const renewalDate =
    subscription?.next_billed_at ||
    subscription?.current_period_end ||
    subscription?.renewal_date ||
    user?.subscription_renewal_date ||
    null

  const showCycleDate = !billingState.isFree && renewalDate

  return (
    <div className="hf-account-card" aria-label="Billing">
      <h2 className="hf-account-card__title">
        <CreditCard size={18} strokeWidth={1.5} className="hf-account-card__icon" />
        Billing
      </h2>

      <p className="hf-billing-card__description">Review billing status and manage your subscription.</p>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label">Current plan</p>
        <p className="hf-account-card__value">{billingState.planLabel}</p>
      </div>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label">Subscription state</p>
        <p className="hf-account-card__value">{billingState.statusLabel}</p>
      </div>

      {showCycleDate ? (
        <div className="hf-account-card__section hf-account-card__section--last">
          <p className="hf-account-card__label">Renewal / cycle date</p>
          <p className="hf-account-card__value">{formatDate(renewalDate)}</p>
        </div>
      ) : (
        <p className="hf-billing-card__description">You do not have an active paid subscription yet. Upgrade to unlock resume analysis, candidate ranking, shortlists, and hiring reports.</p>
      )}

      {billingState.canManageBilling ? (
        <button
          type="button"
          onClick={() => {
            window.location.href = '/billing'
          }}
          className="hf-billing-card__button hf-billing-card__button--primary"
        >
          Manage billing
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            window.location.href = '/pricing'
          }}
          className="hf-billing-card__button hf-billing-card__button--primary"
        >
          View plans
        </button>
      )}
    </div>
  )
}
