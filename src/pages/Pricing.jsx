import { useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import PublicFooter from '../components/PublicFooter'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

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
      style={{
        border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: '14px',
        padding: '2rem',
        background: 'var(--card)',
        boxShadow: selected ? '0 10px 24px rgba(0, 0, 0, 0.18)' : 'none',
        transform: emphasized ? 'scale(1.03)' : 'scale(1)',
        position: 'relative',
      }}
      aria-label={plan.name}
    >
      {plan.badge && (
        <span
          style={{
            position: 'absolute',
            top: '-12px',
            right: '18px',
            background: 'var(--accent)',
            color: 'var(--ink)',
            fontWeight: 700,
            fontSize: '0.8rem',
            borderRadius: '999px',
            padding: '0.35rem 0.75rem',
          }}
        >
          {plan.badge}
        </span>
      )}

      <h2 style={{ fontSize: '1.45rem', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>{plan.name}</h2>

      <p style={{ fontSize: '2.5rem', fontWeight: 700, margin: '0.2rem 0' }}>
        {plan.price}
        <span style={{ fontSize: '1rem', color: 'var(--muted)' }}>{plan.period}</span>
      </p>

      <p style={{ color: 'var(--muted)', margin: '0.35rem 0 0.8rem' }}>{plan.billing}</p>
      {plan.savings && <p style={{ color: 'var(--accent-2)', fontWeight: 600, marginBottom: '1rem' }}>{plan.savings}</p>}
      <p style={{ color: 'var(--muted)', marginBottom: '1.25rem' }}>{plan.trial}</p>

      <button
        type="button"
        onClick={() => onStartCheckout(plan.id)}
        disabled={loading}
        style={{
          width: '100%',
          borderRadius: '8px',
          padding: '0.8rem 1rem',
          border: selected ? 'none' : '1px solid var(--accent)',
          background: selected ? 'var(--accent)' : 'transparent',
          color: selected ? 'var(--ink)' : 'var(--text)',
          fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Preparing checkout…' : plan.cta}
      </button>

      <ul style={{ marginTop: '1.4rem', paddingLeft: '1.1rem', display: 'grid', gap: '0.55rem', color: 'var(--muted)' }}>
        {PLAN_FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </article>
  )
}

export default function Pricing() {
  usePageSeo('HireFlow Pricing', 'Choose monthly or yearly pricing plans for HireFlow. Start with a 7-day free trial and cancel anytime.')

  const [selectedBilling, setSelectedBilling] = useState('annual')
  const [loadingPlan, setLoadingPlan] = useState('')
  const [error, setError] = useState('')

  const startCheckout = async (plan) => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)

    if (!token) {
      navigate('/login')
      return
    }

    setError('')
    setLoadingPlan(plan)

    try {
      const response = await fetch(`${API_BASE_URL}/api/paddle/checkout-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ plan }),
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.checkoutUrl) {
        throw new Error(payload?.error || `Unable to start checkout (${response.status})`)
      }

      window.location.assign(payload.checkoutUrl)
    } catch (checkoutError) {
      setError(checkoutError.message || 'Unable to start checkout right now.')
    } finally {
      setLoadingPlan('')
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)' }}>
      <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '3rem 1rem 1rem' }}>
        <h1 style={{ textAlign: 'center', fontSize: '2.3rem', marginBottom: '0.8rem', fontFamily: 'var(--font-display)' }}>
          Choose your plan
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--muted)', marginBottom: '1.5rem' }}>
          7-day free trial, cancel anytime.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.7rem' }}>
          <div
            role="tablist"
            aria-label="Billing frequency"
            style={{
              display: 'inline-flex',
              border: '1px solid var(--border)',
              borderRadius: '999px',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedBilling === 'monthly'}
              onClick={() => setSelectedBilling('monthly')}
              style={{
                border: 'none',
                background: selectedBilling === 'monthly' ? 'var(--accent)' : 'transparent',
                color: selectedBilling === 'monthly' ? 'var(--ink)' : 'var(--text)',
                padding: '0.6rem 1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedBilling === 'annual'}
              onClick={() => setSelectedBilling('annual')}
              style={{
                border: 'none',
                background: selectedBilling === 'annual' ? 'var(--accent)' : 'transparent',
                color: selectedBilling === 'annual' ? 'var(--ink)' : 'var(--text)',
                padding: '0.6rem 1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Annual
            </button>
          </div>
        </div>

        <p style={{ textAlign: 'center', color: 'var(--muted)', marginBottom: '1.9rem' }}>
          {selectedBilling === 'annual' ? '$79/month (billed annually at $948/year)' : '$99/month billed monthly'}
        </p>

        {error && <p style={{ textAlign: 'center', color: '#f87171', marginBottom: '1.5rem' }}>{error}</p>}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            alignItems: 'stretch',
            gap: '1.2rem',
          }}
        >
          <PricingCard
            plan={PRICING.annual}
            selected={selectedBilling === 'annual'}
            emphasized
            onStartCheckout={startCheckout}
            loading={loadingPlan === 'annual'}
          />
          <PricingCard
            plan={PRICING.monthly}
            selected={selectedBilling === 'monthly'}
            emphasized={false}
            onStartCheckout={startCheckout}
            loading={loadingPlan === 'monthly'}
          />
        </div>
      </section>

      <PublicFooter />
    </main>
  )
}
