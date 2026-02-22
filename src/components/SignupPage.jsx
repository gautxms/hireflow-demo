import { useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

export default function SignupPage({ onAuthSuccess }) {
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

      const payload = await response.json()

      if (!response.ok) {
        setError(payload.error || 'Unable to sign up')
        return
      }

      onAuthSuccess(payload.token)
    } catch {
      setError('Unable to connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '80px auto', padding: 16 }}>
      <h1>Sign up</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label htmlFor="signup-email">Email</label>
        <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label htmlFor="signup-password">Password</label>
        <input id="signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />

        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Creating account...' : 'Sign up'}
        </button>
      </form>
      <p style={{ marginTop: 12 }}>
        Already have an account? <a href="/login">Login</a>
      </p>
    </main>
  )
}
