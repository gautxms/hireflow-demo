import { useEffect, useRef, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import { resolveCheckoutCloseState } from './checkoutState'
import API_BASE from '../config/api'
import { CHECKOUT_PLAN_DETAILS, getCheckoutPlanFromSearch } from '../config/pricingPlans'
import { syncCompletedCheckout } from '../utils/paddleSubscriptionSync'
import { isCanceledSubscription } from '../utils/subscriptionState'
import { PADDLE_LAST_TRANSACTION_STORAGE_KEY } from '../utils/billingSuccessState'
import '../styles/checkout.css'


const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const fallbackClientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN
const CHECKOUT_COMPLETED_STORAGE_KEY = 'hireflow_checkout_completed_at'
const PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY = 'paddle_checkout_active'

function getTestKeyFromQuery() {
  const params = new URLSearchParams(window.location.search)
  return params.get('testKey') || ''
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
  const onAuthSuccessRef = useRef(onAuthSuccess)
  const selectedPlan = getCheckoutPlanFromSearch(window.location.search)
  const plan = selectedPlan ? CHECKOUT_PLAN_DETAILS[selectedPlan] : null
  const testKey = selectedPlan === 'test-monthly' ? getTestKeyFromQuery() : ''
  const [status, setStatus] = useState('idle') // idle, loading, ready, opened, action_required, error
  const [reactivateRequested, setReactivateRequested] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [showRetry, setShowRetry] = useState(false)
  const [requiredAction, setRequiredAction] = useState(null)
  const [transactionId, setTransactionId] = useState(null)
  const [hasSuccessfulTransaction, setHasSuccessfulTransaction] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutAttempt, setCheckoutAttempt] = useState(0)
  const isReturningSubscription = status === 'action_required' && requiredAction === 'cancelled'
  const isSubscriptionlessPaymentRetry = status === 'action_required' && requiredAction === 'payment_retry'

  usePageSeo('HireFlow Checkout', plan ? `Checkout setup for the ${plan.label.toLowerCase()} plan.` : 'Choose a plan to start checkout.')

  useEffect(() => {
    onAuthSuccessRef.current = onAuthSuccess
  }, [onAuthSuccess])

  useEffect(() => {
    let isUnmounted = false
    let checkoutOpenTimer = null
    let paddleRef = null
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

    const persistActiveSubscription = (token, user, redirectPath = '/dashboard') => {
      const normalizedStatus = user?.subscription_status || 'inactive'
      localStorage.setItem('subscription_status', normalizedStatus)

      if (user) {
        localStorage.setItem('hireflow_user_profile', JSON.stringify(user))
      }

      window.dispatchEvent(new CustomEvent('hireflow-auth-updated'))

      if (typeof onAuthSuccessRef.current === 'function' && token) {
        onAuthSuccessRef.current(token, normalizedStatus, user, redirectPath)
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

    const syncSubscriptionAfterPayment = async (token, completedTransactionId, attempts = 8, delayMs = 1200) => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          if (completedTransactionId) {
            await syncCompletedCheckout({ apiBase: API_BASE, token, transactionId: completedTransactionId })
          }

          const result = await verifySubscriptionStatus(token)

          if (result.isActive) {
            console.log('[Checkout] Subscription sync confirmed after payment', {
              attempt,
              status: result.subscriptionStatus,
            })
            sessionStorage.removeItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY)
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

      if (!selectedPlan) {
        setStatus('error')
        setErrorMessage('Please choose a valid plan from the pricing page.')
        return
      }

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
        if (isUnmounted) return
        const isCanceled = isCanceledSubscription(subscriptionStatus)

        if (isActive) {
          console.log('[Checkout] User already subscribed, redirecting to dashboard')
          persistActiveSubscription(token, user, '/dashboard')
          return
        }

        if (isCanceled && !reactivateRequested) {
          console.log('[Checkout] Subscription cancelled, showing reactivation option')
          setStatus('action_required')
          setRequiredAction('cancelled')
          return
        }

        if (subscriptionStatus === 'past_due' || subscriptionStatus === 'payment_failed') {
          if (!user?.paddle_subscription_id) {
            console.log('[Checkout] Previous checkout failed without a recoverable subscription, showing paid retry')
            setStatus('action_required')
            setRequiredAction('payment_retry')
            return
          }
          console.log('[Checkout] Subscription past due, showing payment method update option')
          setStatus('action_required')
          setRequiredAction('past_due')
          return
        }

        if (isCanceled && reactivateRequested) {
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
        
        const checkoutRequestBody = selectedPlan === 'test-monthly'
          ? { plan: selectedPlan, testKey }
          : { plan: selectedPlan }

        const response = await fetch(checkoutApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(checkoutRequestBody),
        })
        if (isUnmounted) return

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
          if (payload?.redirectTo) {
            navigate(payload.redirectTo)
            return
          }
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
        let successRedirectUrl
        try {
          const url = new URL(checkoutUrl)
          initialTransactionId = url.searchParams.get('_ptxn')
          url.searchParams.delete('_ptxn')
          successRedirectUrl = url.toString()
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
        if (isUnmounted) return
        paddleRef = Paddle

        if (paddleEnvironment === 'sandbox') {
          Paddle.Environment.set('sandbox')
        }

        // Step 4: Initialize Paddle with the client token and checkout event callback.
        const effectiveClientToken = checkoutClientToken || fallbackClientToken
        if (!effectiveClientToken || !userEmail) {
          console.error('[Checkout] Missing required Paddle initialization data:', {
            hasClientToken: !!effectiveClientToken,
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
            const syncResult = closedTransactionId
              ? await syncSubscriptionAfterPayment(token, closedTransactionId)
              : await verifySubscriptionStatus(token)
            const { user, isActive } = syncResult || {}
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

        const handleCheckoutCompleted = (eventData) => {
          const completionTransactionId = eventData?.data?.transaction_id || eventData?.transaction_id
          if (isUnmounted || isPaymentFlowCompleted || completionTransactionId !== latestTransactionId) return

          console.log('[Paddle] checkout.completed received:', { transactionId: completionTransactionId })
          isPaymentFlowCompleted = true
          markCheckoutCompleted()
          sessionStorage.setItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY, completionTransactionId)
          sessionStorage.removeItem(PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY)
          setTransactionId(completionTransactionId)
          setHasSuccessfulTransaction(true)
          setCheckoutOpen(false)
          closePaddleCheckout()

          navigate('/billing/success', {
            replace: true,
            state: { transactionId: completionTransactionId, plan: selectedPlan },
          })
        }

        const handlePaddleEvent = (eventData) => {
          if (isUnmounted) return
          const eventTransactionId = eventData?.data?.transaction_id || eventData?.transaction_id
          if (eventTransactionId && eventTransactionId !== latestTransactionId) return

          if (eventData?.name === 'checkout.completed') handleCheckoutCompleted(eventData)
          if (eventData?.name === 'checkout.closed') void handleCheckoutClosed()
          if (eventData?.name === 'checkout.payment.failed') void handleCheckoutFailed(eventData)
        }

        if (Paddle.Initialized) {
          Paddle.Update({ eventCallback: handlePaddleEvent })
        } else {
          Paddle.Initialize({
            token: effectiveClientToken,
            eventCallback: handlePaddleEvent,
          })
        }

        // Step 5: Open the embedded checkout with transaction ID
        console.log('[Checkout] Opening embedded checkout for transaction:', initialTransactionId)
        setStatus('ready')

        // Use setTimeout to ensure Paddle is fully initialized before opening checkout
        checkoutOpenTimer = window.setTimeout(() => {
          if (isUnmounted) return
          console.log('[Checkout] Calling Paddle.Checkout.open with transactionId:', initialTransactionId)

          Paddle.Checkout.open({
            transactionId: initialTransactionId,
            settings: {
              allowLogout: false,
              successUrl: successRedirectUrl,
            },
          })
          setStatus('opened')
          setCheckoutOpen(true)
          sessionStorage.setItem(PADDLE_CHECKOUT_ACTIVE_STORAGE_KEY, 'true')
        }, 500)
      } catch (error) {
        console.error('[Checkout] Error occurred:', error)
        if (!isUnmounted) {
          setStatus('error')
          setErrorMessage(error.message || 'Unable to start checkout')
        }
      }
    }

    initializeCheckout()

    return () => {
      isUnmounted = true
      if (checkoutOpenTimer !== null) window.clearTimeout(checkoutOpenTimer)

      if (paddleRef?.Initialized && typeof paddleRef.Update === 'function') {
        paddleRef.Update({ eventCallback: null })
      }
    }
  }, [checkoutAttempt, reactivateRequested, selectedPlan, testKey])

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
        const pendingTransactionId = transactionId || sessionStorage.getItem(PADDLE_LAST_TRANSACTION_STORAGE_KEY)
        if (pendingTransactionId) {
          await syncCompletedCheckout({ apiBase: API_BASE, token, transactionId: pendingTransactionId })
        }

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

  const isPreparingCheckout = !requiredAction && !errorMessage && !successMessage
    && (status === 'idle' || status === 'loading' || status === 'ready')

  return (
    <main className="checkout-page">
      <div className="checkout-page__content">
        <button
          type="button"
          onClick={() => navigate('/pricing')}
          className="checkout-page__back"
        >
          <span aria-hidden="true">←</span> Back to plans
        </button>

        <header className="checkout-page__header">
          <p className="checkout-page__eyebrow">Secure checkout</p>
          <h1>Complete your subscription</h1>
          <p className="checkout-page__subtitle">
            {plan
              ? <>You selected <strong>{plan.label}</strong> — {plan.price}. Eligible new accounts get a 7-day trial with 10 resume analyses; the paid plan includes {plan.monthlyLimit} analyses/month. Payment is securely processed by Paddle.</>
              : 'Choose a plan to continue to secure checkout.'}
          </p>
        </header>

        {(isReturningSubscription || isSubscriptionlessPaymentRetry) && (
          <section className="checkout-page__card checkout-page__card--action" aria-labelledby="checkout-action-title">
            <div className="checkout-page__card-icon" aria-hidden="true">↗</div>
            <div>
              <p className="checkout-page__card-label">Paid subscription</p>
              <h2 id="checkout-action-title">
                {isSubscriptionlessPaymentRetry ? 'Try your payment again' : 'Restart your subscription'}
              </h2>
              <p>
                {isSubscriptionlessPaymentRetry
                  ? 'Your previous checkout did not create a recoverable subscription. Continue with this paid plan to activate your workspace.'
                  : 'Your previous subscription has ended. Continue with this paid plan to restore full access.'}
              </p>
              <button type="button" onClick={handleReactivateSubscription} className="hf-btn hf-btn--primary">
                {isSubscriptionlessPaymentRetry ? 'Retry payment' : 'Continue to payment'}
              </button>
            </div>
          </section>
        )}

        {status === 'action_required' && requiredAction === 'past_due' && (
          <section className="checkout-page__card checkout-page__card--warning" aria-labelledby="payment-attention-title">
            <div className="checkout-page__card-icon" aria-hidden="true">!</div>
            <div>
              <h2 id="payment-attention-title">Your payment needs attention</h2>
              <p>Update the payment method on your existing subscription before starting another checkout.</p>
              <a href="/account/payment-method" className="hf-btn hf-btn--primary checkout-page__button-link">Update payment method</a>
            </div>
          </section>
        )}

        {!!errorMessage && (
          <div className="checkout-page__message checkout-page__message--error" role="alert">
            <strong>We couldn&apos;t complete that step.</strong>
            <span>{errorMessage}</span>
            {status === 'error' ? <a href="/pricing">Back to plans</a> : null}
          </div>
        )}

        {!!successMessage && (
          <div className="checkout-page__message checkout-page__message--success" role="status">
            {successMessage}
          </div>
        )}

        <div id="paddle-container" hidden aria-hidden="true" />

        {isPreparingCheckout && (
          <div className="checkout-page__progress" role="status" aria-live="polite">
            <span className="checkout-page__spinner" aria-hidden="true" />
            <div>
              <strong>Preparing your secure checkout</strong>
              <p>{getStatusMessage()}</p>
            </div>
          </div>
        )}

        {checkoutOpen && !hasSuccessfulTransaction ? (
          <p className="checkout-page__open-status" role="status">Secure payment form opened.</p>
        ) : null}

        {status === 'opened' && transactionId && (
          <p className="checkout-page__transaction">
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
              setCheckoutAttempt((attempt) => attempt + 1)
            }}
            className="hf-btn hf-btn--primary checkout-page__retry"
          >
            Retry checkout
          </button>
        )}
      </div>
    </main>
  )
}
