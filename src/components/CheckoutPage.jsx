import { useEffect, useMemo, useState } from 'react'

const PAYMENTS_PROVIDER = import.meta.env.VITE_PAYMENTS_PROVIDER
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const PADDLE_PRICE_IDS = {
  starter: import.meta.env.VITE_PADDLE_PRICE_ID_STARTER,
  pro: import.meta.env.VITE_PADDLE_PRICE_ID_PRO,
  enterprise: import.meta.env.VITE_PADDLE_PRICE_ID_ENTERPRISE,
}

function loadPaddleScript() {
  return new Promise((resolve, reject) => {
    if (window.Paddle) {
      resolve(window.Paddle)
      return
    }

    const existing = document.querySelector('script[data-paddle-sdk="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Paddle))
      existing.addEventListener('error', () => reject(new Error('Failed to load Paddle SDK script.')))
      return
    }

    const script = document.createElement('script')
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js'
    script.async = true
    script.dataset.paddleSdk = 'true'
    script.onload = () => resolve(window.Paddle)
    script.onerror = () => reject(new Error('Failed to load Paddle SDK script.'))
    document.head.appendChild(script)
  })
}

export default function CheckoutPage({ onBackHome }) {
  const [status, setStatus] = useState('preparing')
  const [message, setMessage] = useState('Preparing checkout…')
  const [confirmation, setConfirmation] = useState(null)

  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const planId = params.get('plan') || 'starter'
  const purchaseStatus = params.get('status')
  const transactionId = params.get('transaction_id') || params.get('checkout_id')

  useEffect(() => {
    const confirmSubscription = async () => {
      setStatus('confirming')
      setMessage('Confirming subscription status…')

      try {
        const response = await fetch(`${API_BASE_URL}/api/paddle/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            planId,
            transactionId,
            status: purchaseStatus,
          }),
        })

        if (!response.ok) {
          throw new Error('Unable to confirm subscription status.')
        }

        const data = await response.json()
        setConfirmation(data)
        setStatus('confirmed')
        setMessage('Purchase confirmed. Your subscription is now active.')
      } catch (error) {
        console.error('Subscription confirmation failed:', error)
        setStatus('error')
        setMessage('We could not confirm your subscription yet. Please contact support if this continues.')
      }
    }

    if (purchaseStatus === 'success') {
      confirmSubscription()
    }
  }, [planId, purchaseStatus, transactionId])

  useEffect(() => {
    if (purchaseStatus === 'success') {
      return
    }

    if (PAYMENTS_PROVIDER !== 'paddle') {
      setStatus('error')
      setMessage('Paddle checkout is disabled. Set VITE_PAYMENTS_PROVIDER="paddle" to enable this flow.')
      return
    }

    const openPaddleCheckout = async () => {
      setStatus('redirecting')
      setMessage('Opening Paddle checkout…')

      try {
        const paddle = await loadPaddleScript()
        const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN
        const priceId = PADDLE_PRICE_IDS[planId]

        if (!clientToken || !priceId) {
          throw new Error('Missing Paddle checkout configuration.')
        }

        paddle.Initialize({ token: clientToken })

        paddle.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          settings: {
            displayMode: 'overlay',
            successUrl: `${window.location.origin}/checkout?status=success&plan=${encodeURIComponent(planId)}`,
          },
        })

        setMessage('Complete your purchase in the Paddle popup.')
      } catch (error) {
        console.error('Paddle popup checkout failed:', error)

        // Fallback path: hosted checkout redirect if popup SDK flow cannot start.
        const hostedCheckoutBase = import.meta.env.VITE_PADDLE_CHECKOUT_URL
        if (hostedCheckoutBase) {
          const successUrl = `${window.location.origin}/checkout?status=success&plan=${encodeURIComponent(planId)}`
          window.location.href = `${hostedCheckoutBase}?plan=${encodeURIComponent(planId)}&success_url=${encodeURIComponent(successUrl)}`
          return
        }

        setStatus('error')
        setMessage('Could not start Paddle checkout. Check Paddle env configuration and try again.')
      }
    }

    openPaddleCheckout()
  }, [planId, purchaseStatus])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)', padding: '4rem 1.5rem' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Checkout</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          Plan: <strong style={{ color: 'var(--text)' }}>{planId}</strong>
        </p>
        <p style={{ marginBottom: '1.75rem' }}>{message}</p>

        {status === 'confirmed' && confirmation ? (
          <pre
            style={{
              textAlign: 'left',
              background: 'var(--ink-2)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1rem',
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(confirmation, null, 2)}
          </pre>
        ) : null}

        <button
          onClick={onBackHome}
          style={{
            marginTop: '2rem',
            background: 'var(--accent)',
            color: 'var(--ink)',
            border: 'none',
            borderRadius: '6px',
            padding: '0.75rem 1.5rem',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          Back to Home
        </button>
      </div>
    </div>
  )
}
