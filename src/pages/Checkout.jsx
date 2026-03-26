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

/**
 * Wait for Paddle.js to be available (loaded globally in index.html)
 */
function waitForPaddle(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (window.Paddle) {
      resolve(window.Paddle)
      return
    }

    const startTime = Date.now()
    const checkInterval = setInterval(() => {
      if (window.Paddle) {
        clearInterval(checkInterval)
        resolve(window.Paddle)
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval)
        reject(new Error('Paddle.js failed to load (timeout)'))
      }
    }, 100)
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
          endpoint: `${API_BASE_URL}/api/paddle/checkout-url`,
          plan: selectedPlan,
          tokenExists: !!token,
        })

        // Step 1: Get checkout data from backend
        const checkoutApiUrl = `${API_BASE_URL}/api/paddle/checkout-url`
        console.log('[Checkout] CALLING BACKEND:', {
          url: checkoutApiUrl,
          apiBaseUrl: API_BASE_URL,
          isProd: import.meta.env.PROD,
          viteApiBaseUrl: import.meta.env.VITE_API_BASE_URL,
          method: 'POST',
          plan: selectedPlan,
        })
        
        const response = await fetch(checkoutApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            plan: selectedPlan,
          }),
        })

        console.log('[Checkout] BACKEND RESPONSE RECEIVED:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          contentType: response.headers.get('content-type'),
          corsHeaders: {
            'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
            'access-control-allow-credentials': response.headers.get('access-control-allow-credentials'),
          },
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

        // Step 2: Extract transaction ID and user email from response
        // Backend returns: { 
        //   checkoutUrl: "https://hireflow.dev/billing/success?_ptxn=txn_...",
        //   userEmail: "user@example.com",
        //   clientToken: "live_...",
        //   paddleEnvironment: "production"
        // }
        const { checkoutUrl, userEmail, clientToken, paddleEnvironment } = payload

        if (!checkoutUrl) {
          console.error('[Checkout] Missing checkoutUrl in response:', payload)
          throw new Error('Checkout URL not provided by server')
        }

        if (!userEmail) {
          console.error('[Checkout] Missing userEmail in response:', payload)
          throw new Error('User email not provided by server')
        }

        // Extract transaction ID from the URL parameter
        let transactionId
        try {
          const url = new URL(checkoutUrl)
          transactionId = url.searchParams.get('_ptxn')
        } catch (e) {
          console.error('[Checkout] Failed to parse checkout URL:', checkoutUrl, e)
          throw new Error('Invalid checkout URL format')
        }

        if (!transactionId) {
          console.error('[Checkout] Missing transaction ID in checkout URL:', checkoutUrl)
          throw new Error('Transaction ID not found in checkout URL')
        }

        console.log('[Checkout] Extracted transaction ID and user email:', {
          transactionId,
          userEmail,
        })

        // Step 3: Wait for Paddle.js library (loaded globally in index.html)
        console.log('[Checkout] Waiting for Paddle.js...')
        const Paddle = await waitForPaddle()

        // Step 4: Initialize Paddle with client token and user email
        console.log('[Checkout] Initializing Paddle with pwCustomer...')
        if (clientToken && paddleEnvironment && userEmail) {
          if (!Paddle.isInitialized && !Paddle.isInitializing) {
            console.log('[Checkout] Calling Paddle.Initialize with client token and pwCustomer:', {
              tokenExists: !!clientToken,
              environment: paddleEnvironment,
              userEmail,
            })
            Paddle.Initialize({
              token: clientToken,
              environment: paddleEnvironment,
              pwCustomer: {
                email: userEmail,
              },
            })
          }
        } else {
          console.error('[Checkout] Missing required Paddle initialization data:', {
            hasClientToken: !!clientToken,
            hasEnvironment: !!paddleEnvironment,
            hasUserEmail: !!userEmail,
          })
          throw new Error('Missing Paddle initialization data (token, environment, or email)')
        }

        // Step 5: Open the embedded checkout with transaction ID
        console.log('[Checkout] Opening embedded checkout for transaction:', transactionId)
        setStatus('ready')

        // Use setTimeout to ensure Paddle is fully initialized before opening checkout
        setTimeout(() => {
          console.log('[Checkout] Calling Paddle.Checkout.open with transactionId:', transactionId)
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
