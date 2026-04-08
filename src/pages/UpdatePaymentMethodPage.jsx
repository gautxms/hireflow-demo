import { useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'

const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4000'
const DEFAULT_PROD_API_BASE_URL = 'https://hireflow-backend-production.up.railway.app'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }

  return import.meta.env.PROD ? DEFAULT_PROD_API_BASE_URL : DEFAULT_DEV_API_BASE_URL
}

const API_BASE_URL = resolveApiBaseUrl()

export default function UpdatePaymentMethodPage() {
  const [form, setForm] = useState({ cardNumber: '', expiryMonth: '', expiryYear: '', cvc: '' })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  usePageSeo('Update Payment Method', 'Update your billing card details securely.')

  const minExpiryYear = useMemo(() => new Date().getFullYear(), [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')

    const cardDigits = form.cardNumber.replace(/\D/g, '')

    if (cardDigits.length < 12 || cardDigits.length > 19) {
      setError('Please enter a valid card number.')
      return
    }

    if (!form.expiryMonth || Number(form.expiryMonth) < 1 || Number(form.expiryMonth) > 12) {
      setError('Please enter a valid expiry month (1-12).')
      return
    }

    if (!form.expiryYear || Number(form.expiryYear) < minExpiryYear) {
      setError(`Please enter a valid expiry year (${minExpiryYear} or later).`)
      return
    }

    if (!/^\d{3,4}$/.test(form.cvc)) {
      setError('Please enter a valid CVC (3-4 digits).')
      return
    }

    if (!token) {
      setError('Please login to update payment method.')
      return
    }

    try {
      setSubmitting(true)
      const response = await fetch(`${API_BASE_URL}/api/subscriptions/payment-method`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to update payment method')
      }

      setMessage(payload.message || 'Payment method updated')
      window.setTimeout(() => {
        window.location.href = '/account?payment=updated'
      }, 900)
    } catch (submitError) {
      setError(submitError.message || 'Unable to update payment method')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)', padding: '2.5rem 1rem' }}>
      <section style={{ maxWidth: 560, margin: '0 auto' }}>
        <BackButton />
        <h1>Update Payment Method</h1>
        <p style={{ color: 'var(--muted)' }}>Enter your card details below. Your account will remain on the billing page after this update.</p>

        <form onSubmit={handleSubmit} style={{ marginTop: '1rem', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <label htmlFor="card-number">Card Number</label>
          <input id="card-number" value={form.cardNumber} onChange={(event) => setForm((prev) => ({ ...prev, cardNumber: event.target.value }))} placeholder="4242 4242 4242 4242" style={{ width: '100%', marginBottom: 10 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label htmlFor="expiry-month">Month</label>
              <input id="expiry-month" value={form.expiryMonth} onChange={(event) => setForm((prev) => ({ ...prev, expiryMonth: event.target.value }))} placeholder="MM" />
            </div>
            <div>
              <label htmlFor="expiry-year">Year</label>
              <input id="expiry-year" value={form.expiryYear} onChange={(event) => setForm((prev) => ({ ...prev, expiryYear: event.target.value }))} placeholder="YYYY" />
            </div>
            <div>
              <label htmlFor="cvc">CVC</label>
              <input id="cvc" value={form.cvc} onChange={(event) => setForm((prev) => ({ ...prev, cvc: event.target.value }))} placeholder="CVC" />
            </div>
          </div>

          {error ? <p style={{ color: '#ff8f8f' }}>{error}</p> : null}
          {message ? <p style={{ color: '#86efac' }}>{message}</p> : null}

          <button type="submit" disabled={submitting} style={{ marginTop: 14 }}>
            {submitting ? 'Updating...' : 'Update payment method'}
          </button>
        </form>
      </section>
    </main>
  )
}
