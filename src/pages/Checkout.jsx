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
const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN
const CHECKOUT_COMPLETED_STORAGE_KEY = 'hireflow_checkout_completed_at'
const PADDLE_LAST_TRANSACTION_STORAGE_KEY = 'paddle_last_transaction'
const PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY = 'paddle_checkout_active'

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

function navigate(pathname, options = {}) {
  if (window.location.pathname !== pathname) {
    window.history.pushState(options.state ?? {}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
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

export default function Checkout({ onAuthSuccess }) {
  const selectedPlan = getPlanFromQuery()
  const plan = PLAN_DETAILS[selectedPlan]
  const [status, setStatus] = useState('idle') // idle, loading, ready, opened, action_required, error
  const [reactivateRequested, setReactivateRequested] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [showRetry, setShowRetry] = useState(false)
  const [requiredAction, setRequiredAction] = useState(null)
  const [transactionId, setTransactionId] = useState(null)
  const [hasSuccessfulTransaction, setHasSuccessfulTransaction] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)

  usePageSeo('HireFlow Checkout', `Checkout setup for the ${plan.label.toLowerCase()} plan.`)

  useEffect(() => {
    let isUnmounted = false
    let paddleRef = null
    let checkoutFailedHandler = null
    let checkoutClosedHandler = null
    let latestTransactionId = null
    let isPaymentFlowCompleted = false

    const markCheckoutCompleted = () => {
      sessionStorage.setItem(CHECKOUT_COMPLETED_STORAGE_KEY, String(Date.now()))
    }

    const wasCheckoutRecentlyCompleted = () => {
      const raw = sessionStorage.getItem(CHECKOUT_COMPLETED_STORAGE_KEY)
      if (!raw) {
        return false
      }

      const completedAt = Number(raw)

      if (!Number.isFinite(completedAt)) {
        sessionStorage.removeItem(CHECKOUT_COMPLETED_STORAGE_KEY)
        return false
      }

      // Prevent reopening the embedded popup when users refresh shortly after paying.
      return Date.now() - completedAt < 20 * 60 * 1000
    }

    const closePaddleCheckout = () => {
      if (typeof paddleRef?.Checkout?.close === 'function') {
        paddleRef.Checkout.close()
      }
    }

    const persistActiveSubscription = (token, user, redirectPath = '/uploader') => {
      const normalizedStatus = user?.subscription_status || 'inactive'
      localStorage.setItem('subscription_status', normalizedStatus)

      if (user) {
        localStorage.setItem('hireflow_user_profile', JSON.stringify(user))
      }

      window.dispatchEvent(new CustomEvent('hireflow-auth-updated'))

      if (typeof onAuthSuccess === 'function' && token) {
        onAuthSuccess(token, normalizedStatus, user, redirectPath)
      } else {
        navigate(redirectPath)
      }
    }

    const verifySubscriptionStatus = async (token) => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error('Your session has expired. Please log in again.')
          }

          throw new Error(`Verification failed (${response.status})`)
        }

        const user = await response.json()
        const subscriptionStatus = user?.subscription_status || 'inactive'
        return {
          user,
          subscriptionStatus,
          isActive: subscriptionStatus === 'active' || subscriptionStatus === 'trialing',
        }
      } catch (error) {
        console.error('[Checkout] Failed to verify subscription status:', error)
        throw error
      }
    }

    async function initializeCheckout() {
      setStatus('loading')
      setErrorMessage('')
      setSuccessMessage('')
      setShowRetry(false)
      setRequiredAction(null)

      if (wasCheckoutRecentlyCompleted()) {
        navigate('/billing/success')
        return
      }

      const token = localStorage.getItem(TOKEN_STORAGE_KEY)

      if (!token) {
        setStatus('error')
        setErrorMessage('Please log in before starting checkout.')
        return
      }

      try {
        console.log('[Checkout] Checking subscription status before initializing checkout')
        const { user, isActive, subscriptionStatus } = await verifySubscriptionStatus(token)

        if (isActive) {
          console.log('[Checkout] User already subscribed, redirecting to dashboard')
          persistActiveSubscription(token, user, '/uploader')
          navigate('/uploader', { replace: true })
          return
        }

        if (subscriptionStatus === 'cancelled' && !reactivateRequested) {
          console.log('[Checkout] Subscription cancelled, showing reactivation option')
          setStatus('action_required')
          setRequiredAction('cancelled')
          return
        }

        if (subscriptionStatus === 'past_due') {
          console.log('[Checkout] Subscription past due, showing payment method update option')
          setStatus('action_required')
          setRequiredAction('past_due')
          return
        }

        if (subscriptionStatus === 'cancelled' && reactivateRequested) {
          console.log('[Checkout] Reactivation requested, opening checkout')
        } else {
          console.log('[Checkout] User not subscribed, opening checkout')
        }
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
        
        console.log('[DEBUG] Fetching URL:', checkoutApiUrl)
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
          const raw = await response.text()
          console.log('[DEBUG] Raw response text:', raw)
          payload = JSON.parse(raw)
          console.log('[Checkout] Response payload:', payload)
          console.log('[DEBUG] Full payload:', JSON.stringify(payload))
        } catch (parseErr) {
          console.error('[Checkout] Failed to parse JSON:', parseErr)
          throw new Error(`Invalid response from server: ${response.statusText}`)
        }

        if (!response.ok) {
          console.error('[Checkout] Response not OK:', { status: response.status, payload })
          throw new Error(payload?.error || payload?.message || `Checkout failed (${response.status})`)
        }

        // Step 2: Extract checkout URL and user email from response
        // Backend returns: { 
        //   checkoutUrl: "https://hireflow.dev/billing/success?_ptxn=txn_...",
        //   userEmail: "user@example.com",
        //   clientToken: "live_..."
        // }
        // clientToken comes from environment variables for better security
        const { checkoutUrl, userEmail, clientToken: checkoutClientToken, paddleEnvironment } = payload
        console.log('[DEBUG] userEmail value:', userEmail)
        console.log('[DEBUG] userEmail type:', typeof userEmail)

        console.log('[DEBUG] About to validate userEmail:', userEmail)
        if (!checkoutUrl) {
          console.error('[Checkout] Missing checkoutUrl in response:', payload)
          throw new Error('Checkout URL not provided by server')
        }

        if (!userEmail) {
          console.error('[Checkout] Missing userEmail in response:', payload)
          throw new Error('User email not provided by server')
        }

        // Extract transaction ID from the URL parameter
        let initialTransactionId
        try {
          const url = new URL(checkoutUrl)
          initialTransactionId = url.searchParams.get('_ptxn')
        } catch (e) {
          console.error('[Checkout] Failed to parse checkout URL:', checkoutUrl, e)
          throw new Error('Invalid checkout URL format')
        }

        if (!initialTransactionId) {
          console.error('[Checkout] Missing transaction ID in checkout URL:', checkoutUrl)
          throw new Error('Transaction ID not found in checkout URL')
        }
        latestTransactionId = initialTransactionId
        setTransactionId(initialTransactionId)
        sessionStorage.setItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY, initialTransactionId)

        console.log('[Checkout] Extracted transaction ID and user email:', {
          transactionId: initialTransactionId,
          userEmail,
        })

        // Step 3: Wait for Paddle.js library (loaded globally in index.html)
        console.log('[Checkout] Waiting for Paddle.js...')
        const Paddle = await waitForPaddle()
        paddleRef = Paddle

        // Step 4: Initialize Paddle with client token and user email
        console.log('[Checkout] Initializing Paddle with pwCustomer...')
        if (clientToken && userEmail) {
          if (!Paddle.isInitialized && !Paddle.isInitializing) {
            console.log('[Checkout] Calling Paddle.Initialize with client token and pwCustomer:', {
              tokenExists: !!clientToken,
              userEmail,
            })
            Paddle.Initialize({
              token: clientToken,
              pwCustomer: {
                email: userEmail,
              },
            })
          }
        } else {
          console.error('[Checkout] Missing required Paddle initialization data:', {
            hasClientToken: !!clientToken,
            hasUserEmail: !!userEmail,
          })
          throw new Error('Missing Paddle initialization data (token or email)')
        }

        const handleCheckoutFailed = async (eventData) => {
          console.log('[Paddle] Checkout failed:', eventData)
          const paddleErrorMessage = eventData?.error?.message || 'Unknown error'
          if (!isUnmounted) {
            setErrorMessage(`Payment failed: ${paddleErrorMessage}`)
            setShowRetry(true)
          }
          console.log('[Checkout] User can retry payment')
        }

        const handleCheckoutClosed = async () => {
          console.log('[Paddle] Checkout closed by user')
          setCheckoutOpen(false)

          if (isPaymentFlowCompleted) {
            return
          }

          const closedTransactionId = sessionStorage.getItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY) || latestTransactionId

          if (closedTransactionId) {
            console.log('[Checkout] Checking if transaction succeeded...')
            await new Promise((resolve) => setTimeout(resolve, 2000))
          }

          try {
            const { user, isActive } = await verifySubscriptionStatus(token)

            if (isActive) {
              console.log('[Checkout] Payment succeeded despite popup close')
              isPaymentFlowCompleted = true
              setHasSuccessfulTransaction(true)
              markCheckoutCompleted()
              sessionStorage.removeItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY)
              persistActiveSubscription(token, user, '/billing/success')
              navigate('/billing/success', {
                replace: true,
                state: {
                  transactionId: closedTransactionId,
                  plan: user?.subscription_plan || selectedPlan,
                  message: 'Payment received! Your subscription is now active.',
                },
              })
              return
            }

            if (!isUnmounted) {
              console.log('[Checkout] User closed without payment, showing retry option')
              setShowRetry(true)
              setStatus('opened')
              setErrorMessage('Checkout closed before payment completed. You can retry checkout from this page.')
            }
          } catch {
            if (!isUnmounted) {
              setShowRetry(true)
              setStatus('opened')
              setErrorMessage('Could not verify payment after closing checkout. Please retry checkout.')
            }
          }
        }

        checkoutFailedHandler = handleCheckoutFailed
        checkoutClosedHandler = handleCheckoutClosed

        // Step 5: Open the embedded checkout with transaction ID
        console.log('[Checkout] Opening embedded checkout for transaction:', initialTransactionId)
        setStatus('ready')

        // Use setTimeout to ensure Paddle is fully initialized before opening checkout
        setTimeout(() => {
          console.log('[Checkout] Calling Paddle.Checkout.open with transactionId:', initialTransactionId)

          if (typeof Paddle.Checkout?.addEventListener === 'function') {
            Paddle.Checkout.addEventListener('checkout.failed', handleCheckoutFailed)
            Paddle.Checkout.addEventListener('checkout.closed', handleCheckoutClosed)
          }

          Paddle.Checkout.open({
            transactionId: initialTransactionId,
            client: checkoutClientToken || clientToken,
            environment: paddleEnvironment,
            settings: {
              allowLogout: false,
            },
            onComplete: async (transaction) => {
              console.log('[Paddle] onComplete callback fired:', transaction)

              if (isPaymentFlowCompleted) {
                return
              }

              const completionTransactionId = transaction?.id || latestTransactionId
              latestTransactionId = completionTransactionId
              setTransactionId(completionTransactionId)
              sessionStorage.setItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY, completionTransactionId)
              isPaymentFlowCompleted = true
              markCheckoutCompleted()
              sessionStorage.removeItem(PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY)

              if (!isUnmounted) {
                setStatus('loading')
                setHasSuccessfulTransaction(true)
                setCheckoutOpen(false)
                setSuccessMessage('Payment successful! Redirecting to billing confirmation…')
              }

              closePaddleCheckout()
              navigate('/billing/success', {
                replace: true,
                state: {
                  transactionId: completionTransactionId,
                  plan: selectedPlan,
                  message: 'Welcome! Your subscription is now active.',
                },
              })
            },
          })
          setStatus('opened')
          setCheckoutOpen(true)
          sessionStorage.setItem(PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY, 'true')
        }, 500)
      } catch (error) {
        console.error('[Checkout] Error occurred:', error)
        setStatus('error')
        setErrorMessage(error.message || 'Unable to start checkout')
      }
    }

    initializeCheckout()

    return () => {
      isUnmounted = true
      sessionStorage.removeItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY)

      if (typeof paddleRef?.Checkout?.removeEventListener === 'function') {
        try {
          paddleRef.Checkout.removeEventListener('checkout.failed', checkoutFailedHandler)
          paddleRef.Checkout.removeEventListener('checkout.closed', checkoutClosedHandler)
        } catch {
          paddleRef.Checkout.removeEventListener('checkout.failed')
          paddleRef.Checkout.removeEventListener('checkout.closed')
        }
      }
    }
  }, [onAuthSuccess, reactivateRequested, selectedPlan])

  useEffect(() => {
    if (!checkoutOpen || hasSuccessfulTransaction) {
      return undefined
    }

    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) {
      return undefined
    }

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!response.ok) {
          return
        }

        const user = await response.json()
        const isActive = user?.subscription_status === 'active' || user?.subscription_status === 'trialing'

        if (!isActive) {
          return
        }

        console.log('[Checkout] Polling detected payment success')
        clearInterval(pollInterval)
        sessionStorage.removeItem(PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY)
        setHasSuccessfulTransaction(true)
        setCheckoutOpen(false)

        navigate('/billing/success', {
          replace: true,
          state: {
            transactionId: transactionId || sessionStorage.getItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY),
            plan: user?.subscription_plan || selectedPlan,
            message: 'Payment successful! Your subscription is now active.',
          },
        })
      } catch (err) {
        console.error('[Checkout] Poll error:', err)
      }
    }, 2000)

    return () => clearInterval(pollInterval)
  }, [checkoutOpen, hasSuccessfulTransaction, selectedPlan, transactionId])

  useEffect(() => () => {
    sessionStorage.removeItem(PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY)
  }, [])

  const handleReactivateSubscription = () => {
    setErrorMessage('')
    setSuccessMessage('')
    setShowRetry(false)
    setStatus('loading')
    setReactivateRequested(true)
  }

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (hasSuccessfulTransaction && checkoutOpen) {
        event.preventDefault()
        event.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasSuccessfulTransaction, checkoutOpen])

  const getStatusMessage = () => {
    switch (status) {
      case 'loading':
        return 'Verifying subscription and preparing checkout…'
      case 'ready':
      case 'opened':
        return 'Loading secure checkout…'
      case 'action_required':
        return 'Action required before opening checkout.'
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
            {getStatusMessage()}
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
          {successMessage && (
            <p style={{ margin: 0, color: '#8effb8', fontWeight: 600 }}>
              {successMessage}
            </p>
          )}
          {status === 'action_required' && requiredAction === 'cancelled' && (
            <div
              style={{
                marginTop: '0.5rem',
                background: '#fef3c7',
                border: '1px solid #f59e0b',
                borderRadius: '8px',
                padding: '1rem',
              }}
            >
              <p style={{ margin: 0, color: '#92400e' }}>
                Your subscription was cancelled. Reactivate to regain access to resume analysis.
              </p>
              <button
                type="button"
                onClick={handleReactivateSubscription}
                style={{
                  marginTop: '0.75rem',
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.7rem 1rem',
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reactivate Subscription
              </button>
            </div>
          )}
          {status === 'action_required' && requiredAction === 'past_due' && (
            <div style={{ marginTop: '0.5rem' }}>
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                Your subscription is past due. Please update your payment method to continue.
              </p>
              <a href="/billing" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 700, marginTop: '0.5rem', display: 'inline-block' }}>
                Update payment method →
              </a>
            </div>
          )}
        </div>

        {status === 'opened' && (
          <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--card)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: 0 }}>
              ✓ Checkout is open above. After completing payment, you'll be redirected to confirm your subscription.
            </p>
            {transactionId && (
              <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.5rem', marginBottom: 0 }}>
                Transaction reference: {transactionId}
              </p>
            )}
            {showRetry && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  marginTop: '0.75rem',
                  border: '1px solid var(--accent)',
                  borderRadius: '8px',
                  background: 'transparent',
                  color: 'var(--text)',
                  padding: '0.6rem 1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Retry checkout
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
