import { useEffect, useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import PublicFooter from '../components/PublicFooter'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

const PLAN_DETAILS = {
  monthly: {
    label: 'Monthly',
    summary: 'You selected the monthly subscription.',
  },
  annual: {
    label: 'Annual',
    summary: 'You selected the annual subscription.',
  },
}

const PRICE_IDS_BY_PLAN = {
  monthly: import.meta.env.VITE_PADDLE_PRICE_MONTHLY,
  annual: import.meta.env.VITE_PADDLE_PRICE_ANNUAL,
}

function getPlanFromQuery() {
  const params = new URLSearchParams(window.location.search)
  const plan = params.get('plan')
  return plan === 'monthly' || plan === 'annual' ? plan : 'monthly'
}

export default function Checkout() {
  const selectedPlan = getPlanFromQuery()
  const plan = PLAN_DETAILS[selectedPlan]
  const priceId = useMemo(() => PRICE_IDS_BY_PLAN[selectedPlan] || '', [selectedPlan])
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')

  usePageSeo('HireFlow Checkout', `Checkout setup for the ${plan.label.toLowerCase()} plan.`)

  useEffect(() => {
    async function sendCheckoutPayload() {
      setStatus('loading')
      setErrorMessage('')

      try {
        const response = await fetch(`${API_BASE_URL}/api/payments/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            plan: selectedPlan,
            priceId,
          }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload.error || 'Checkout payload failed')
        }

        setStatus('success')
      } catch (error) {
        setStatus('error')
        setErrorMessage(error.message || 'Unable to send checkout payload')
      }
    }

    sendCheckoutPayload()
  }, [selectedPlan, priceId])

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)' }}>
      <section style={{ maxWidth: '900px', margin: '0 auto', padding: '3rem 1rem 2rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.3rem', marginBottom: '0.75rem' }}>Checkout</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>{plan.summary}</p>

        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: '14px',
            background: 'var(--card)',
            padding: '1.5rem',
            display: 'grid',
            gap: '0.75rem',
          }}
        >
          <p style={{ margin: 0, color: 'var(--muted)' }}>Selected plan</p>
          <p style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>{plan.label}</p>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            {status === 'error' ? 'We could not prepare checkout. Please try again.' : 'Redirecting to secure checkout…'}
          </p>
          {errorMessage ? <p style={{ margin: 0, color: '#ff8f8f' }}>Error: {errorMessage}</p> : null}
        </div>
      </section>

      <PublicFooter />
    </main>
  )
}
