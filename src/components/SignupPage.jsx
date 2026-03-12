import { useState } from 'react'
import './AuthPage.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}
export default function SignupPage({ onSignupSuccess, onGoToLogin }) {
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (!acceptedTerms) {
      setError('You must agree to the Terms and Privacy Policy to continue')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, company, phone }),
      })

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        setError(payload?.error || `Signup failed (${response.status})`)
        return
      }

      onSignupSuccess()
    } catch {
      setError('Unable to connect to auth server. Check backend URL / CORS settings.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow--a" />
      <div className="auth-glow auth-glow--b" />
      <section className="auth-panel">
        <button
          className="auth-back-button"
          type="button"
          onClick={() => navigate('/')}
          aria-label="Back to home"
        >
          ← Back to Home
        </button>
        <p className="auth-brand">Hire<span>Flow</span></p>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-subtitle">Start ranking resumes in minutes.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="signup-email">Email <span className="auth-required">*</span></label>
          <input className="auth-input" id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

          <label className="auth-label" htmlFor="signup-company">Company</label>
          <input className="auth-input" id="signup-company" type="text" value={company} onChange={(e) => setCompany(e.target.value)} />

          <label className="auth-label" htmlFor="signup-phone">Phone</label>
          <input className="auth-input" id="signup-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />

          <label className="auth-label" htmlFor="signup-password">Password <span className="auth-required">*</span></label>
          <div className="auth-input-with-action">
            <input className="auth-input" id="signup-password" type={isPasswordVisible ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <button
              className="auth-input-action"
              type="button"
              aria-label={isPasswordVisible ? 'Hide password fields' : 'Show password fields'}
              title={isPasswordVisible ? 'Hide password fields' : 'Show password fields'}
              onClick={() => setIsPasswordVisible((visible) => !visible)}
            >
              👁
            </button>
          </div>

          <label className="auth-label" htmlFor="signup-confirm-password">Confirm password <span className="auth-required">*</span></label>
          <input className="auth-input" id="signup-confirm-password" type={isPasswordVisible ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />

          <label className="auth-checkbox-row" htmlFor="signup-terms">
            <input id="signup-terms" type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
            <span>I agree to the <a className="auth-link" href="/terms">Terms</a> and <a className="auth-link" href="/privacy">Privacy Policy</a></span>
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Sign up'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <button className="auth-link" type="button" onClick={onGoToLogin}>Login</button>
        </p>
      </section>
    </main>
  )
}
