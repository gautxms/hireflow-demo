import { useState } from 'react'
import './AuthPage.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

export default function SignupPage({ onAuthSuccess, onGoToLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        setError(payload?.error || `Signup failed (${response.status})`)
        return
      }

      if (!payload?.token) {
        setError('Signup succeeded but token was missing from response')
        return
      }

      onAuthSuccess(payload)
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
        <p className="auth-brand">Hire<span>Flow</span></p>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-subtitle">Start ranking resumes in minutes.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="signup-email">Email</label>
          <input className="auth-input" id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

          <label className="auth-label" htmlFor="signup-password">Password</label>
          <input className="auth-input" id="signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />

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
