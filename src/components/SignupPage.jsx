import { useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

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

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        setError(payload?.error || `Signup failed (${response.status})`)
        return
      }

      if (!payload?.token) {
        setError('Signup succeeded but token was missing from response')
        return
      }

      onAuthSuccess(payload.token)
    } catch {
      setError('Unable to connect to auth server. Check backend URL / CORS settings.')
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
