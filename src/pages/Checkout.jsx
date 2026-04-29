import { useEffect, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import { resolveCheckoutCloseState } from './checkoutState'
import API_BASE from '../config/api'


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
  const isReactivation = status === 'action_required' && requiredAction === 'cancelled'

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
        const response = await fetch(`${API_BASE}/auth/me`, {
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

    const syncSubscriptionAfterPayment = async (token, attempts = 8, delayMs = 1200) => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const result = await verifySubscriptionStatus(token)

          if (result.isActive) {
            console.log('[Checkout] Subscription sync confirmed after payment', {
              attempt,
              status: result.subscriptionStatus,
            })
            return result
          }

          console.log('[Checkout] Subscription not active yet, retrying sync', {
            attempt,
            status: result.subscriptionStatus,
          })
        } catch (error) {
          console.warn('[Checkout] Subscription sync attempt failed', {
            attempt,
            error: error?.message || String(error),
          })
        }

        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }

      return null
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
          apiUrl: API_BASE,
          endpoint: `${API_BASE}/paddle/checkout-url`,
          plan: selectedPlan,
          tokenExists: !!token,
        })

        // Step 1: Get checkout data from backend
        const checkoutApiUrl = `${API_BASE}/paddle/checkout-url`
        console.log('[Checkout] CALLING BACKEND:', {
          url: checkoutApiUrl,
          apiBaseUrl: API_BASE,
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
          const raw = await response.text()
          payload = JSON.parse(raw)
          console.log('[Checkout] Response payload:', payload)
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
            setStatus('opened')
          }
          sessionStorage.removeItem(PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY)
          console.log('[Checkout] User can retry payment')
        }

        const handleCheckoutClosed = async () => {
          console.log('[Paddle] Checkout closed by user')
          setCheckoutOpen(false)
          sessionStorage.removeItem(PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY)

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
            const outcome = resolveCheckoutCloseState({ isActiveSubscription: isActive, verificationFailed: false })

            if (outcome.nextStatus === 'success') {
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
                  message: outcome.message,
                },
              })
              return
            }

            if (!isUnmounted) {
              console.log('[Checkout] User closed without payment, showing retry option')
              setShowRetry(outcome.shouldShowRetry)
              setStatus('opened')
              setRequiredAction(null)
              setErrorMessage(outcome.message)
            }
          } catch {
            if (!isUnmounted) {
              const outcome = resolveCheckoutCloseState({ isActiveSubscription: false, verificationFailed: true })
              setShowRetry(outcome.shouldShowRetry)
              setStatus('opened')
              setErrorMessage(outcome.message)
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
              const synced = await syncSubscriptionAfterPayment(token)

              if (synced?.isActive) {
                persistActiveSubscription(token, synced.user, '/billing/success')
              }

              navigate('/billing/success', {
                replace: true,
                state: {
                  transactionId: completionTransactionId,
                  plan: synced?.user?.subscription_plan || selectedPlan,
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
        const response = await fetch(`${API_BASE}/auth/me`, {
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
        if (typeof window.Paddle?.Checkout?.close === 'function') {
          window.Paddle.Checkout.close()
        }
        const normalizedStatus = user?.subscription_status || 'inactive'
        localStorage.setItem('subscription_status', normalizedStatus)

        if (user) {
          localStorage.setItem('hireflow_user_profile', JSON.stringify(user))
        }

        window.dispatchEvent(new CustomEvent('hireflow-auth-updated'))

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
    <main style={{
      background: '#0a0a0a',
      minHeight: '100vh',
      padding: '40px 20px',
      color: '#ffffff',
    }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="hf-btn hf-btn--primary"
          style={{
            background: 'transparent',
            color: '#CCFF00',
            border: 'none',
            cursor: 'pointer',
            marginBottom: '40px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          ← Back to Home
        </button>

        <h1 className="type-h1" style={{ marginBottom: '12px' }}>
          Checkout
        </h1>

        <p className="type-body" style={{ color: '#a3a3a3', marginBottom: '40px' }}>
          You selected the <strong style={{ color: '#CCFF00' }}>{selectedPlan}</strong> subscription.
        </p>

        {isReactivation && (
          <div style={{
            background: 'rgba(204, 255, 0, 0.15)',
            border: '2px solid #CCFF00',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '32px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <span style={{ fontSize: '24px' }}>⚡</span>
              <div>
                <h3 className="type-h3" style={{ color: '#CCFF00', marginBottom: '8px' }}>
                  Reactivate Your Subscription
                </h3>
                <p className="type-small" style={{ color: '#a3a3a3', marginBottom: '16px' }}>
                  Your subscription was cancelled. Reactivate now to regain access to resume analysis and full features.
                </p>
                <button
                  type="button"
                  onClick={handleReactivateSubscription}
                  className="hf-btn hf-btn--primary"
                  style={{
                    background: '#CCFF00',
                    color: '#000000',
                    border: 'none',
                    borderRadius: '6px',
                    transition: 'opacity 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                >
                  Reactivate Now
                </button>
              </div>
            </div>
          </div>
        )}

        {status === 'action_required' && requiredAction === 'past_due' && (
          <div style={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
            <p style={{ margin: 0, color: '#a3a3a3' }}>
              Your previous payment needs attention. Please update your payment method from the billing portal.
            </p>
            <a href="/billing" className="checkout-page__notice-link">Open billing portal</a>
          </div>
        )}

        {(errorMessage || successMessage) && (
          <div style={{ marginBottom: '24px' }}>
            {!!errorMessage && (
              <p style={{ margin: '0 0 8px', color: '#ff8f8f' }}>
                Error: {errorMessage}
                {status === 'error' && (
                  <>
                    <br />
                    <a href="/pricing" style={{ color: '#CCFF00', textDecoration: 'none', marginTop: '1rem', display: 'inline-block' }}>
                      ← Back to Pricing
                    </a>
                  </>
                )}
              </p>
            )}
            {!!successMessage && <p className="type-small" style={{ margin: 0, color: '#CCFF00', fontWeight: 600 }}>{successMessage}</p>}
            {!errorMessage && <p style={{ margin: '8px 0 0', color: '#a3a3a3' }}>{getStatusMessage()}</p>}
          </div>
        )}

        <div
          id="paddle-container"
          style={{
            background: '#1a1a1a',
            borderRadius: '12px',
            padding: '32px',
            border: '1px solid #333333',
            minHeight: '500px',
          }}
        />

        {!checkoutOpen && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#a3a3a3' }}>
            <p style={{ marginBottom: '8px' }}>Loading secure checkout...</p>
            <div style={{ animation: 'pulse 2s infinite', display: 'inline-block' }}>
              <span style={{ fontSize: '24px' }}>🔐</span>
            </div>
          </div>
        )}

        {status === 'opened' && transactionId && (
          <p className="type-small" style={{ color: '#a3a3a3', marginTop: '12px' }}>
            Transaction reference: {transactionId}
          </p>
        )}

        {showRetry && !hasSuccessfulTransaction && (
          <button
            type="button"
            onClick={() => {
              setShowRetry(false)
              setStatus('loading')
              setErrorMessage('')
              setSuccessMessage('')
              if (requiredAction === 'cancelled') {
                setReactivateRequested(true)
              } else {
                setRequiredAction(null)
              }
            }}
            className="hf-btn hf-btn--primary"
            style={{
              marginTop: '16px',
              background: '#CCFF00',
              color: '#000000',
            }}
          >
            Retry checkout
          </button>
        )}

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    </main>
  )
}
