import { useMemo } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

function CheckoutFormScaffold({ paymentsEnabled }) {
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      style={{ display: 'grid', gap: '1rem' }}
    >
      <div
        style={{
          border: '1px dashed #475569',
          borderRadius: 10,
          padding: '1rem',
          color: '#cbd5e1',
          background: '#0f172a',
        }}
      >
        {paymentsEnabled
          ? 'Stripe Elements placeholder (to be implemented).'
          : 'Payments coming soon'}
      </div>

      <button
        type='submit'
        disabled={!paymentsEnabled}
        style={{
          background: paymentsEnabled ? '#eab308' : '#334155',
          color: paymentsEnabled ? '#0f172a' : '#94a3b8',
          border: 'none',
          borderRadius: 10,
          padding: '0.85rem 1rem',
          fontWeight: 700,
          cursor: paymentsEnabled ? 'pointer' : 'not-allowed',
        }}
      >
        Submit payment
      </button>
    </form>
  )
}

export default function CheckoutPage({ onBack }) {
  const paymentsEnabled = String(import.meta.env.VITE_STRIPE_ENABLED || '').toLowerCase() === 'true'
  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''

  const stripePromise = useMemo(() => {
    if (!paymentsEnabled || !publishableKey) {
      return null
    }

    return loadStripe(publishableKey)
  }, [paymentsEnabled, publishableKey])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0f172a 0%, #111827 50%, #0b1220 100%)',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: '3rem 1.25rem',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            color: '#cbd5e1',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '0.5rem 0.9rem',
            cursor: 'pointer',
            marginBottom: '2rem',
          }}
        >
          ← Back
        </button>

        <h1 style={{ marginTop: 0 }}>Checkout</h1>
        <p style={{ color: '#cbd5e1' }}>
          {paymentsEnabled ? 'Secure payment flow will be available here soon.' : 'Payments coming soon'}
        </p>

        {paymentsEnabled && stripePromise ? (
          <Elements stripe={stripePromise}>
            <CheckoutFormScaffold paymentsEnabled={paymentsEnabled} />
          </Elements>
        ) : (
          <CheckoutFormScaffold paymentsEnabled={false} />
        )}
      </div>
    </div>
  )
}
