import { useEffect, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'

const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4000'
const DEFAULT_PROD_API_BASE_URL = 'https://hireflow-backend-production.up.railway.app'

function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }

  return import.meta.env.PROD ? DEFAULT_PROD_API_BASE_URL : DEFAULT_DEV_API_BASE_URL
}

const API_BASE_URL = resolveApiBaseUrl()
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
        console.log('[Checkout] Starting checkout with:', {
          apiUrl: API_BASE_URL,
          endpoint: `${API_BASE_URL}/api/paddle/checkout-url`,
          plan: selectedPlan,
          tokenExists: !!token,
        })

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

        console.log('[Checkout] Fetch completed:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
        })

        let payload
        try {
          payload = await response.json()
          console.log('[Checkout] Response payload:', payload)
        } catch (parseErr) {
          console.error('[Checkout] Failed to parse JSON:', parseErr)
          throw new Error(`Invalid response from server: ${response.statusText}`)
        }

        if (!response.ok) {
          console.error('[Checkout] Response not OK:', { status: response.status, payload })
          throw new Error(payload?.error || payload?.message || `Checkout failed (${response.status})`)
        }

        if (!payload.checkoutUrl) {
          console.error('[Checkout] No checkoutUrl in payload:', payload)
          throw new Error('No checkout URL received from server')
        }

        console.log('[Checkout] Got URL, redirecting to:', payload.checkoutUrl)
        setStatus('success')
        window.location.assign(payload.checkoutUrl)
      } catch (error) {
        console.error('[Checkout] Error occurred:', error)
        setStatus('error')
        setErrorMessage(error.message || 'Unable to start checkout')
      }
    }

    sendCheckoutPayload()
  }, [selectedPlan])

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)' }}>
      <section style={{ maxWidth: '900px', margin: '0 auto', padding: '3rem 1rem 2rem' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <BackButton />
        </div>

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
