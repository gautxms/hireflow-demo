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
const PADDLE_SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js'

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

/**
 * Load Paddle.js dynamically from CDN
 */
function loadPaddleScript() {
  return new Promise((resolve, reject) => {
    if (window.Paddle) {
      resolve(window.Paddle)
      return
    }

    const script = document.createElement('script')
    script.src = PADDLE_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.Paddle) {
        resolve(window.Paddle)
      } else {
        reject(new Error('Paddle failed to load'))
      }
    }
    script.onerror = () => reject(new Error('Failed to load Paddle script'))
    document.head.appendChild(script)
  })
}

export default function Checkout() {
  const selectedPlan = getPlanFromQuery()
  const plan = PLAN_DETAILS[selectedPlan]
  const [status, setStatus] = useState('idle') // idle, loading, ready, opened, error
  const [errorMessage, setErrorMessage] = useState('')

  usePageSeo('HireFlow Checkout', `Checkout setup for the ${plan.label.toLowerCase()} plan.`)

  useEffect(() => {
    async function initializeCheckout() {
      setStatus('loading')
      setErrorMessage('')

      const token = localStorage.getItem(TOKEN_STORAGE_KEY)

      if (!token) {
        setStatus('error')
        setErrorMessage('Please log in before starting checkout.')
        return
      }

      try {
        console.log('[Checkout] Starting embedded checkout with:', {
          apiUrl: API_BASE_URL,
          endpoint: `${API_BASE_URL}/api/paddle/checkout`,
          plan: selectedPlan,
          tokenExists: !!token,
        })

        // Step 1: Get transaction ID and client token from backend
        // Try new endpoint first, fallback to old endpoint for backwards compatibility
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

        console.log('[Checkout] Backend response:', {
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

        const { transactionId, clientToken, paddleEnvironment } = payload

        if (!transactionId || !clientToken) {
          console.error('[Checkout] Missing transaction ID or client token:', payload)
          throw new Error('Invalid checkout data from server')
        }

        console.log('[Checkout] Got transaction data:', { transactionId, paddleEnvironment })

        // Step 2: Load Paddle.js library
        console.log('[Checkout] Loading Paddle.js...')
        const Paddle = await loadPaddleScript()

        // Step 3: Initialize Paddle with client token
        console.log('[Checkout] Initializing Paddle with client token')
        Paddle.Environment.set(paddleEnvironment || 'production')
        Paddle.Initialize({
          token: clientToken,
          pwCustomer: {
            email: '', // Backend provides email, Paddle will fetch from transaction
          },
        })

        // Step 4: Open the embedded checkout
        console.log('[Checkout] Opening embedded checkout for transaction:', transactionId)
        setStatus('ready')

        // Use setTimeout to ensure Paddle is fully initialized before opening checkout
        setTimeout(() => {
          Paddle.Checkout.open({
            transactionId,
          })
          setStatus('opened')
        }, 500)
      } catch (error) {
        console.error('[Checkout] Error occurred:', error)
        setStatus('error')
        setErrorMessage(error.message || 'Unable to start checkout')
      }
    }

    initializeCheckout()
  }, [selectedPlan])

  const getStatusMessage = () => {
    switch (status) {
      case 'loading':
        return 'Preparing checkout…'
      case 'ready':
      case 'opened':
        return 'Loading secure checkout…'
      case 'error':
        return 'We could not prepare checkout. Please try again.'
      default:
        return 'Initializing checkout…'
    }
  }

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
            {status === 'error' ? getStatusMessage() : 'Opening secure checkout…'}
          </p>
          {errorMessage && (
            <p style={{ margin: 0, color: '#ff8f8f' }}>
              Error: {errorMessage}
              {status === 'error' && (
                <>
                  <br />
                  <a href="/pricing" style={{ color: 'var(--accent)', textDecoration: 'none', marginTop: '1rem', display: 'inline-block' }}>
                    ← Back to Pricing
                  </a>
                </>
              )}
            </p>
          )}
        </div>

        {status === 'opened' && (
          <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--card)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: 0 }}>
              ✓ Checkout is open above. After completing payment, you'll be redirected to confirm your subscription.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
