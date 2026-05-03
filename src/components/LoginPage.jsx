import { useState } from 'react'
import './AuthPage.css'
import BackButton from './BackButton'
import API_BASE from '../config/api'
import BrandLogo from './BrandLogo'

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
        setError(payload?.error || `Unable to log in (${response.status})`)
        return
      }

      if (!payload?.token) {
        setError('Log in succeeded, but a token was missing from the response.')
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
      setError('Unable to connect to the auth server. Check the backend URL and CORS settings.')
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
          <BrandLogo as="p" className="auth-brand" />
          <h1 className="auth-title">Verify your email</h1>
          <p className="auth-subtitle">You must verify your email address before you can log in.</p>

          <div className="auth-form">
            <p className="auth-help-text auth-help-text--compact">
              We've sent a verification email to <strong>{unverifiedEmail}</strong>. Check your inbox and click the verification link to continue.
            </p>

            <p className="auth-help-text auth-help-text--spaced">
              If you don't see the email, check your spam folder or click below to resend it.
            </p>

            <button
              className="auth-submit"
              type="button"
              onClick={() => onNavigateToVerifyEmail?.(unverifiedEmail)}
            >
              Resend verification email
            </button>

            <button
              className="auth-link auth-link--block"
              type="button"
              onClick={() => setEmailNotVerified(false)}
            >
              Back to log in
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
        <BrandLogo as="p" className="auth-brand" />
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to continue screening candidates faster.</p>
        {promptMessage && <p className="auth-prompt">{promptMessage}</p>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="login-email">Email</label>
          <input className="auth-input" id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

          <label className="auth-label" htmlFor="login-password">Password</label>
          <input className="auth-input" id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

          <p className="auth-row auth-row--right">
            <button className="auth-link" type="button" onClick={onForgotPassword}>Forgot password?</button>
          </p>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="auth-switch">
          Need an account? <button className="auth-link" type="button" onClick={onGoToSignup}>Sign up</button>
        </p>
      </section>
    </main>
  )
}
