import { useState } from 'react'
import './AuthPage.css'
import BackButton from './BackButton'
import API_BASE from '../config/api'

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

export default function LoginPage({ onAuthSuccess, onGoToSignup, onForgotPassword, promptMessage, onNavigateToVerifyEmail }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [emailNotVerified, setEmailNotVerified] = useState(false)
  const [unverifiedEmail, setUnverifiedEmail] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setEmailNotVerified(false)
    setLoading(true)

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        setError(payload?.error || `Login failed (${response.status})`)
        return
      }

      if (!payload?.token) {
        setError('Login succeeded but token was missing from response')
        return
      }

      // Check if email is verified
      if (payload?.user?.email_verified === false) {
        setEmailNotVerified(true)
        setUnverifiedEmail(payload?.user?.email || email)
        return
      }

      onAuthSuccess(payload.token, payload?.user?.subscription_status || 'inactive', payload?.user || null)
    } catch {
      setError('Unable to connect to auth server. Check backend URL / CORS settings.')
    } finally {
      setLoading(false)
    }
  }

  if (emailNotVerified && unverifiedEmail) {
    return (
      <main className="auth-shell">
        <div className="auth-glow auth-glow--a" />
        <div className="auth-glow auth-glow--b" />
        <section className="auth-panel">
          <p className="auth-brand">Hire<span>Flow</span></p>
          <h1 className="auth-title">Verify your email</h1>
          <p className="auth-subtitle">You must verify your email address before logging in.</p>

          <div className="auth-form">
            <p style={{ color: '#9ca3af', marginBottom: '1rem' }}>
              We've sent a verification email to <strong>{unverifiedEmail}</strong>. Check your inbox and click the verification link to continue.
            </p>

            <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>
              If you don't see the email, check your spam folder or click below to resend it.
            </p>

            <button
              className="auth-submit"
              type="button"
              onClick={() => onNavigateToVerifyEmail?.(unverifiedEmail)}
              style={{ marginBottom: '1rem' }}
            >
              Resend verification email
            </button>

            <button
              className="auth-link"
              type="button"
              onClick={() => setEmailNotVerified(false)}
              style={{ display: 'block', width: '100%', textAlign: 'center', marginTop: '1rem' }}
            >
              Back to login
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow--a" />
      <div className="auth-glow auth-glow--b" />
      <section className="auth-panel">
        <BackButton />
        <p className="auth-brand">Hire<span>Flow</span></p>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to continue screening candidates faster.</p>
        {promptMessage && <p className="auth-prompt">{promptMessage}</p>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="login-email">Email</label>
          <input className="auth-input" id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

          <label className="auth-label" htmlFor="login-password">Password</label>
          <input className="auth-input" id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

          <p style={{ margin: '-0.25rem 0 0.25rem', textAlign: 'right' }}>
            <button className="auth-link" type="button" onClick={onForgotPassword}>Forgot password?</button>
          </p>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="auth-switch">
          Need an account? <button className="auth-link" type="button" onClick={onGoToSignup}>Sign up</button>
        </p>
      </section>
    </main>
  )
}
