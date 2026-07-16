import { useRef, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import API_BASE from '../config/api'
import '../styles/billing.css'
import '../styles/checkout.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function navigateInternal(pathname) {
  if (typeof window === 'undefined' || window.location.pathname === pathname) return

  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function UpdatePaymentMethodPage() {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const checkoutPayloadRef = useRef(null)

  usePageSeo('Update Payment Method', 'Update billing securely through Paddle.')

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
        Paddle.Initialize({ token: payload.clientToken })
      }

      Paddle.Checkout.open({
        transactionId: payload.transactionId,
        client: payload.clientToken,
        environment: payload.paddleEnvironment,
        settings: { allowLogout: false },
        onComplete: () => {
          if (typeof Paddle.Checkout?.close === 'function') Paddle.Checkout.close()
          window.location.assign('/billing?payment_method=updated')
        },
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
            {status === 'opened' && !error ? (
              <p className="checkout-page__message checkout-page__message--success" role="status">
                Secure form opened. If you closed it, you can reopen it below.
              </p>
            ) : null}

            <div className="payment-method-card__actions">
              <button
                type="button"
                className="hf-btn hf-btn--primary"
                onClick={openSecurePaymentUpdate}
                disabled={status === 'loading'}
                aria-busy={status === 'loading'}
              >
                {status === 'loading' ? 'Opening secure form…' : status === 'opened' ? 'Reopen secure form' : 'Continue with Paddle'}
              </button>
              <span className="payment-method-card__security">Securely processed by Paddle</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
