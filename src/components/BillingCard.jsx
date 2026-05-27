import './accountCards.css'

const BILLING_STATUS_MAP = {
  trialing: 'trial',
  cancelled: 'canceled',
}

function formatPlan(plan) {
  if (!plan) return 'N/A'
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function formatState(status) {
  if (!status) return 'inactive'
  const normalized = String(status).toLowerCase()
  return BILLING_STATUS_MAP[normalized] || normalized
}

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
  const plan = subscription?.plan || user?.subscription_plan || null
  const state = subscription?.status || user?.subscription_status || 'inactive'
  const renewalDate =
    subscription?.next_billed_at ||
    subscription?.current_period_end ||
    subscription?.renewal_date ||
    user?.subscription_renewal_date ||
    null

  return (
    <div className="hf-account-card" aria-label="Billing">
      <h2 className="hf-account-card__title">
        <span className="hf-account-card__icon">💳</span>
        Billing
      </h2>

      <p className="hf-billing-card__description">Review billing status and manage your subscription.</p>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label">Current plan</p>
        <p className="hf-account-card__value">{formatPlan(plan)}</p>
      </div>

      <div className="hf-account-card__section">
        <p className="hf-account-card__label">Subscription state</p>
        <p className="hf-account-card__value hf-account-card__value--capitalize">{formatState(state)}</p>
      </div>

      <div className="hf-account-card__section hf-account-card__section--last">
        <p className="hf-account-card__label">Renewal / cycle date</p>
        <p className="hf-account-card__value">{formatDate(renewalDate)}</p>
      </div>

      <button
        onClick={() => {
          window.location.href = '/billing'
        }}
        className="hf-billing-card__button hf-billing-card__button--primary"
      >
        Manage billing
      </button>
    </div>
  )
}
