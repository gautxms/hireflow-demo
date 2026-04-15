import { useState } from 'react'
import BackButton from '../components/BackButton'
import '../components/AuthPage.css'
import API_BASE from '../config/api'

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

export default function ForgotPasswordPage({ onBackToLogin }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      const response = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        setError(payload?.error || `Request failed (${response.status})`)
        return
      }

      setSuccess(payload?.message || 'Check your email for reset link')
      setEmail('')
    } catch {
      setError('Unable to process request right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow--a" />
      <div className="auth-glow auth-glow--b" />
      <section className="auth-panel">
        <BackButton />
        <p className="auth-brand">Hire<span>Flow</span></p>
        <h1 className="auth-title">Forgot your password?</h1>
        <p className="auth-subtitle">Enter your email and we&apos;ll send you a secure reset link.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="forgot-email">Email</label>
          <input
            className="auth-input"
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          {error && <p className="auth-error">{error}</p>}
          {success && <p style={{ color: '#047857', margin: 0 }}>{success}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'Sending reset link...' : 'Send Reset Link'}
          </button>
        </form>

        <p className="auth-switch">
          Remembered your password?{' '}
          <button className="auth-link" type="button" onClick={onBackToLogin}>
            Back to login
          </button>
        </p>
      </section>
    </main>
  )
}
