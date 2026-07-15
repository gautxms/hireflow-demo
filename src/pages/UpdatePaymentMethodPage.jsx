import { useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'
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

  usePageSeo('Update Payment Method', 'Update billing securely through Paddle.')

  async function openSecurePaymentUpdate() {
    if (status === 'loading') return

    setStatus('loading')
    setError('')

    try {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (!token) throw new Error('Please log in before updating billing.')

      const response = await fetch(`${API_BASE}/subscriptions/payment-method`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to start the secure billing update.')

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
    <main className="billing-shell">
      <section className="billing-shell__section">
        <div className="page-header">
          <div>
            <h1 className="page-title">Update payment method</h1>
            <p className="page-subtitle">
              Billing recovery is handled through Paddle&apos;s secure billing flow so HireFlow never collects or processes card numbers, expiry dates, or security codes.
            </p>
          </div>
          <BackButton />
        </div>

        <div className="billing-shell__form" aria-labelledby="secure-payment-update-title">
          <h2 id="secure-payment-update-title" className="billing-modal__title">Secure billing update</h2>
          <p className="billing-modal__muted">
            Paddle will open a secure checkout to replace the payment method on your subscription. If a payment is overdue, Paddle will show and collect the outstanding amount before access is restored.
          </p>
          {error ? <p className="billing-page__feedback billing-page__feedback--error" role="alert">{error}</p> : null}
          <div className="billing-shell__actions">
            <button type="button" className="hf-btn hf-btn--primary" onClick={openSecurePaymentUpdate} disabled={status === 'loading'}>
              {status === 'loading' ? 'Opening secure checkout…' : status === 'opened' ? 'Secure checkout opened' : 'Continue with Paddle'}
            </button>
            <button type="button" className="hf-btn hf-btn--secondary" onClick={() => navigateInternal('/billing')}>
              Back to billing
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
