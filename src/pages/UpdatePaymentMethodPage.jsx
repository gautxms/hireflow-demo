import { useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'
import API_BASE from '../config/api'
import '../styles/billing.css'
import '../styles/checkout.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

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
      const response = await fetch(`${API_BASE}/subscriptions/payment-method`, {
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
    <main className="billing-shell">
      <section className="billing-shell__section">
        <BackButton />
        <h1 className="billing-shell__title">Update Payment Method</h1>
        <p className="billing-shell__subtitle">Enter your card details below. Your account will remain on the billing page after this update.</p>

        <form onSubmit={handleSubmit} className="billing-shell__form">
          <label htmlFor="card-number" className="billing-shell__label">Card Number</label>
          <input
            id="card-number"
            className="billing-shell__input"
            value={form.cardNumber}
            onChange={(event) => setForm((prev) => ({ ...prev, cardNumber: event.target.value }))}
            placeholder="4242 4242 4242 4242"
          />

          <div className="billing-shell__form-grid">
            <div className="billing-shell__field">
              <label htmlFor="expiry-month" className="billing-shell__label">Month</label>
              <input id="expiry-month" className="billing-shell__input" value={form.expiryMonth} onChange={(event) => setForm((prev) => ({ ...prev, expiryMonth: event.target.value }))} placeholder="MM" />
            </div>
            <div className="billing-shell__field">
              <label htmlFor="expiry-year" className="billing-shell__label">Year</label>
              <input id="expiry-year" className="billing-shell__input" value={form.expiryYear} onChange={(event) => setForm((prev) => ({ ...prev, expiryYear: event.target.value }))} placeholder="YYYY" />
            </div>
            <div className="billing-shell__field">
              <label htmlFor="cvc" className="billing-shell__label">CVC</label>
              <input id="cvc" className="billing-shell__input" value={form.cvc} onChange={(event) => setForm((prev) => ({ ...prev, cvc: event.target.value }))} placeholder="CVC" />
            </div>
          </div>

          {error ? <p className="billing-shell__feedback--error">{error}</p> : null}
          {message ? <p className="billing-shell__feedback--success">{message}</p> : null}

          <button type="submit" disabled={submitting} className="hf-btn hf-btn--primary">
            {submitting ? 'Updating...' : 'Update payment method'}
          </button>
        </form>
      </section>
    </main>
  )
}
