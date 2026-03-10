import { useEffect, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

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

function getPlanFromQuery() {
  const params = new URLSearchParams(window.location.search)
  const plan = params.get('plan')
  return plan === 'monthly' || plan === 'annual' ? plan : 'monthly'
}

export default function Checkout() {
  const selectedPlan = getPlanFromQuery()
  const plan = PLAN_DETAILS[selectedPlan]
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')

  usePageSeo('HireFlow Checkout', `Checkout setup for the ${plan.label.toLowerCase()} plan.`)

  useEffect(() => {
    async function sendCheckoutPayload() {
      setStatus('loading')
      setErrorMessage('')

      const token = localStorage.getItem(TOKEN_STORAGE_KEY)

      if (!token) {
        setStatus('error')
        setErrorMessage('Please log in before starting checkout.')
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/paddle/checkout-url`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            plan: selectedPlan,
          }),
        })

        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload.error || 'Checkout payload failed')
        }

        if (!payload.checkoutUrl) {
          throw new Error('No checkout URL received from server')
        }

        setStatus('success')
        window.location.assign(payload.checkoutUrl)
      } catch (error) {
        setStatus('error')
        setErrorMessage(error.message || 'Unable to start checkout')
      }
    }

    sendCheckoutPayload()
  }, [selectedPlan])

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)' }}>
      <section style={{ maxWidth: '900px', margin: '0 auto', padding: '3rem 1rem 2rem' }}>
        <button
          type="button"
          onClick={() => navigate('/pricing')}
          style={{
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--accent)',
            borderRadius: 8,
            padding: '0.55rem 0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: '1.25rem',
          }}
        >
          ← Back to Pricing
        </button>

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

    </main>
  )
}
