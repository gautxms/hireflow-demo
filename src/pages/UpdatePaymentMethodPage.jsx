import { useEffect, useRef, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import API_BASE from '../config/api'
import '../styles/billing.css'
import '../styles/checkout.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'trial'])
const SYNC_ATTEMPTS = 10
const SYNC_DELAY_MS = 1200

function wait(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

function navigateInternal(pathname) {
  if (typeof window === 'undefined' || window.location.pathname === pathname) return

  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function UpdatePaymentMethodPage() {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const checkoutPayloadRef = useRef(null)
  const mountedRef = useRef(true)
  const completionInFlightRef = useRef(false)
  const checkoutEventHandlersRef = useRef(null)

  usePageSeo('Update Payment Method', 'Update billing securely through Paddle.')

  useEffect(() => () => {
    mountedRef.current = false
    const Paddle = window.Paddle
    const handlers = checkoutEventHandlersRef.current
    if (handlers && typeof Paddle?.Checkout?.removeEventListener === 'function') {
      Paddle.Checkout.removeEventListener('checkout.completed', handlers.completed)
      Paddle.Checkout.removeEventListener('checkout.closed', handlers.closed)
    }
  }, [])

  async function verifySubscription(token) {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Your session expired. Please log in again.')
      }
      throw new Error('Unable to confirm your updated billing status.')
    }

    const user = await response.json()
    return {
      user,
      isActive: ACTIVE_SUBSCRIPTION_STATUSES.has(String(user?.subscription_status || '').toLowerCase()),
    }
  }

  async function waitForBillingRecovery(token) {
    for (let attempt = 1; attempt <= SYNC_ATTEMPTS; attempt += 1) {
      try {
        const result = await verifySubscription(token)
        if (result.isActive) return result.user
      } catch (syncError) {
        if (attempt === SYNC_ATTEMPTS) throw syncError
      }

      if (attempt < SYNC_ATTEMPTS) await wait(SYNC_DELAY_MS)
    }

    return null
  }

  function persistRecoveredAccess(user) {
    const subscriptionStatus = user?.subscription_status || 'inactive'
    localStorage.setItem('subscription_status', subscriptionStatus)
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
    window.dispatchEvent(new CustomEvent('hireflow-auth-updated'))
  }

  async function handleCheckoutCompleted(event) {
    if (completionInFlightRef.current) return

    const payload = checkoutPayloadRef.current
    const eventTransactionId = event?.data?.transaction_id
      || event?.data?.transaction?.id
      || event?.transaction_id
      || event?.id
    if (eventTransactionId && payload?.transactionId && eventTransactionId !== payload.transactionId) return

    completionInFlightRef.current = true
    if (mountedRef.current) {
      setStatus('syncing')
      setError('')
    }

    const Paddle = window.Paddle
    if (typeof Paddle?.Checkout?.close === 'function') Paddle.Checkout.close()

    try {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (!token) throw new Error('Your session expired. Please log in again.')

      const user = await waitForBillingRecovery(token)
      if (user) {
        persistRecoveredAccess(user)
        window.location.assign('/dashboard?payment_recovered=1')
        return
      }

      // Force a fresh account read even when Paddle's webhook takes longer than
      // the bounded in-page sync window.
      window.location.assign('/billing?payment_method=updated&sync=pending')
    } catch (syncError) {
      completionInFlightRef.current = false
      if (mountedRef.current) {
        setStatus('error')
        setError(syncError.message || 'Payment was received, but access could not be refreshed. Check billing to retry.')
      }
    }
  }

  async function openSecurePaymentUpdate() {
    if (status === 'loading') return

    setStatus('loading')
    setError('')

    try {
      let payload = checkoutPayloadRef.current

      if (!payload) {
        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        if (!token) throw new Error('Please log in before updating billing.')

        const response = await fetch(`${API_BASE}/subscriptions/payment-method`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Unable to start the secure billing update.')
        checkoutPayloadRef.current = payload
      }

      const Paddle = window.Paddle
      if (!Paddle || !payload.clientToken) {
        if (payload.checkoutUrl) {
          window.location.assign(payload.checkoutUrl)
          return
        }
        throw new Error('Secure Paddle checkout is temporarily unavailable.')
      }

      if (payload.paddleEnvironment === 'sandbox') Paddle.Environment.set('sandbox')
      if (!Paddle.isInitialized && !Paddle.isInitializing) {
        Paddle.Initialize({
          token: payload.clientToken,
          eventCallback: (event) => {
            if (event?.name === 'checkout.completed') void handleCheckoutCompleted(event)
            if (event?.name === 'checkout.closed' && mountedRef.current && !completionInFlightRef.current) {
              setStatus('opened')
            }
          },
        })
      }

      const completedHandler = (event) => { void handleCheckoutCompleted(event) }
      const closedHandler = () => {
        if (mountedRef.current && !completionInFlightRef.current) setStatus('opened')
      }
      if (typeof Paddle.Checkout?.addEventListener === 'function') {
        const previousHandlers = checkoutEventHandlersRef.current
        if (previousHandlers && typeof Paddle.Checkout.removeEventListener === 'function') {
          Paddle.Checkout.removeEventListener('checkout.completed', previousHandlers.completed)
          Paddle.Checkout.removeEventListener('checkout.closed', previousHandlers.closed)
        }
        Paddle.Checkout.addEventListener('checkout.completed', completedHandler)
        Paddle.Checkout.addEventListener('checkout.closed', closedHandler)
        checkoutEventHandlersRef.current = { completed: completedHandler, closed: closedHandler }
      }

      Paddle.Checkout.open({
        transactionId: payload.transactionId,
        client: payload.clientToken,
        environment: payload.paddleEnvironment,
        settings: { allowLogout: false },
        onComplete: (transaction) => { void handleCheckoutCompleted(transaction) },
      })
      setStatus('opened')
    } catch (err) {
      setStatus('error')
      setError(err.message || 'Unable to update payment method.')
    }
  }

  return (
    <main className="payment-method-page">
      <section className="payment-method-page__content" aria-labelledby="payment-method-title">
        <button type="button" className="checkout-page__back" onClick={() => navigateInternal('/billing')}>
          <span aria-hidden="true">←</span> Back to billing
        </button>

        <header className="payment-method-page__header">
          <p className="checkout-page__eyebrow">Billing &amp; plans</p>
          <h1 id="payment-method-title">Update payment method</h1>
          <p>
            Replace the payment method used for your HireFlow subscription through Paddle&apos;s secure billing flow.
          </p>
        </header>

        <div className="payment-method-card" aria-labelledby="secure-payment-update-title">
          <div className="payment-method-card__icon" aria-hidden="true">↗</div>
          <div className="payment-method-card__body">
            <h2 id="secure-payment-update-title">Continue securely with Paddle</h2>
            <p>
              A secure payment form will open over this page. HireFlow never sees or stores your payment details.
            </p>
            <p className="payment-method-card__note">
              If a payment is overdue, Paddle will show the outstanding amount before you confirm anything.
            </p>

            {error ? <p className="checkout-page__message checkout-page__message--error" role="alert">{error}</p> : null}
            {status === 'syncing' && !error ? (
              <p className="checkout-page__message checkout-page__message--success" role="status">
                Billing updated. Restoring your workspace access…
              </p>
            ) : status === 'opened' && !error ? (
              <p className="checkout-page__message checkout-page__message--success" role="status">
                Secure form opened. If you closed it, you can reopen it below.
              </p>
            ) : null}

            <div className="payment-method-card__actions">
              <button
                type="button"
                className="hf-btn hf-btn--primary"
                onClick={openSecurePaymentUpdate}
                disabled={status === 'loading' || status === 'syncing'}
                aria-busy={status === 'loading' || status === 'syncing'}
              >
                {status === 'loading'
                  ? 'Opening secure form…'
                  : status === 'syncing'
                    ? 'Restoring access…'
                    : status === 'opened'
                      ? 'Reopen secure form'
                      : 'Continue with Paddle'}
              </button>
              <span className="payment-method-card__security">Securely processed by Paddle</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
