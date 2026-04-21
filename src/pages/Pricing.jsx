import { useState } from 'react'
import BackButton from '../components/BackButton'
import '../styles/pricing.css'

const PLAN_FEATURES = [
  'Unlimited resume uploads',
  'AI-powered candidate screening',
  'Bias-reduced scoring',
  'Secure data handling',
  'Email support',
]

const PRICING = {
  annual: {
    id: 'annual',
    name: 'Annual Plan',
    badge: 'Best Value',
    price: '$79',
    period: '/month',
    billing: 'Billed annually at $948/year',
    savings: 'Save $240 per year compared to monthly',
    trial: '7-day free trial, cancel anytime',
    cta: 'Start Annual',
  },
  monthly: {
    id: 'monthly',
    name: 'Monthly Plan',
    badge: null,
    price: '$99',
    period: '/month',
    billing: 'Billed monthly',
    savings: null,
    trial: '7-day free trial, cancel anytime',
    cta: 'Start Monthly',
  },
}

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function PricingCard({ plan, selected, emphasized, onStartCheckout, loading }) {
  return (
    <article
      className={`pricing-card ${selected ? 'is-selected' : ''} ${emphasized ? 'is-emphasized' : ''}`}
      aria-label={plan.name}
    >
      {plan.badge && <span className="pricing-card__badge">{plan.badge}</span>}

      <h2 className="pricing-card__title">{plan.name}</h2>

      <p className="pricing-card__price">
        {plan.price}
        <span className="pricing-card__period">{plan.period}</span>
      </p>

      <p className="pricing-card__billing">{plan.billing}</p>
      {plan.savings && <p className="pricing-card__savings">{plan.savings}</p>}
      <p className="pricing-card__trial">{plan.trial}</p>

      <button
        type="button"
        onClick={() => onStartCheckout(plan.id)}
        disabled={loading}
        className={`pricing-card__cta ${selected ? 'is-selected' : ''}`}
      >
        {loading ? 'Preparing checkout…' : plan.cta}
      </button>

      <ul className="pricing-card__features">
        {PLAN_FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </article>
  )
}

export default function Pricing({ isAuthenticated, onRequireAuth }) {
  const [selectedBilling, setSelectedBilling] = useState('annual')

  const startCheckout = (plan) => {
    if (!isAuthenticated) {
      onRequireAuth('Please log in or sign up to purchase a plan.')
      return
    }

    navigate(`/checkout?plan=${plan}`)
  }

  return (
    <main className="pricing-page">
      <section className="pricing-page__content">
        <div className="pricing-page__back">
          <BackButton />
        </div>

        <h1 className="pricing-page__title">Choose your plan</h1>
        <p className="pricing-page__subtitle">
          7-day free trial, cancel anytime.
        </p>
        <p className="pricing-page__subtitle">
          New to HireFlow? Read our <a href="/ai-resume-screening">AI resume screening guide</a> or visit the <a href="/help">Help Center</a>.
        </p>

        <div className="pricing-page__toggle-wrap">
          <div
            role="tablist"
            aria-label="Billing frequency"
            className="pricing-page__toggle"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedBilling === 'monthly'}
              onClick={() => setSelectedBilling('monthly')}
              className={`pricing-page__toggle-button ${selectedBilling === 'monthly' ? 'is-selected' : ''}`}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedBilling === 'annual'}
              onClick={() => setSelectedBilling('annual')}
              className={`pricing-page__toggle-button ${selectedBilling === 'annual' ? 'is-selected' : ''}`}
            >
              Annual
            </button>
          </div>
        </div>

        <p className="pricing-page__price-note">
          {selectedBilling === 'annual' ? '$79/month (billed annually at $948/year)' : '$99/month billed monthly'}
        </p>

        <div className="pricing-page__grid">
          <PricingCard
            plan={PRICING.annual}
            selected={selectedBilling === 'annual'}
            emphasized
            onStartCheckout={startCheckout}
            loading={false}
          />
          <PricingCard
            plan={PRICING.monthly}
            selected={selectedBilling === 'monthly'}
            emphasized={false}
            onStartCheckout={startCheckout}
            loading={false}
          />
        </div>
      </section>

    </main>
  )
}
