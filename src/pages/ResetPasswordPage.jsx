import { useEffect, useMemo, useState } from 'react'
import BackButton from '../components/BackButton'
import '../components/AuthPage.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

function getStrengthLabel(password) {
  if (password.length < 8) return 'Too short'
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasNumber = /\d/.test(password)
  const hasSpecial = /[^A-Za-z0-9]/.test(password)
  const score = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length

  if (score <= 1) return 'Weak'
  if (score <= 3) return 'Medium'
  return 'Strong'
}

function getTokenFromQuery() {
  const params = new URLSearchParams(window.location.search)
  return params.get('token') || ''
}

export default function ResetPasswordPage({ onGoToLogin }) {
  const [token] = useState(() => getTokenFromQuery())
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [isTokenValid, setIsTokenValid] = useState(false)
  const [isCheckingToken, setIsCheckingToken] = useState(true)

  const passwordStrength = useMemo(() => getStrengthLabel(password), [password])

  useEffect(() => {
    let isMounted = true

    async function verifyToken() {
      if (!token) {
        setError('This reset link is invalid. Please request a new one.')
        setIsTokenValid(false)
        setIsCheckingToken(false)
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/reset-password?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          credentials: 'include',
        })

        const payload = await parseResponsePayload(response)

        if (!isMounted) {
          return
        }

        if (!response.ok || !payload?.valid) {
          setError('This reset link has expired or is invalid. Please request a new one.')
          setIsTokenValid(false)
          return
        }

        setIsTokenValid(true)
      } catch {
        if (isMounted) {
          setError('Unable to verify reset link. Please try again later.')
          setIsTokenValid(false)
        }
      } finally {
        if (isMounted) {
          setIsCheckingToken(false)
        }
      }
    }

    verifyToken()

    return () => {
      isMounted = false
    }
  }, [token])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, newPassword: password, confirmPassword }),
      })

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        setError(payload?.error || `Reset failed (${response.status})`)
        return
      }

      setSuccess('Password reset! Redirecting to login...')
      setPassword('')
      setConfirmPassword('')
      setIsTokenValid(false)

      setTimeout(() => {
        onGoToLogin()
      }, 1500)
    } catch {
      setError('Unable to reset password right now. Please try again.')
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
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-subtitle">Choose a strong password you haven&apos;t used before.</p>

        {isCheckingToken ? (
          <p>Verifying reset link...</p>
        ) : (
          <>
            {!isTokenValid && error && <p className="auth-error">{error}</p>}

            {isTokenValid && (
              <form className="auth-form" onSubmit={handleSubmit}>
                <label className="auth-label" htmlFor="reset-password">New password</label>
                <input
                  className="auth-input"
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
                  Password strength: <strong>{passwordStrength}</strong>
                </p>

                <label className="auth-label" htmlFor="confirm-password">Confirm password</label>
                <input
                  className="auth-input"
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />

                {error && <p className="auth-error">{error}</p>}
                {success && <p style={{ color: '#047857', margin: 0 }}>{success}</p>}

                <button className="auth-submit" type="submit" disabled={loading}>
                  {loading ? 'Resetting password...' : 'Reset Password'}
                </button>
              </form>
            )}
          </>
        )}

        <p className="auth-switch">
          <button className="auth-link" type="button" onClick={onGoToLogin}>
            Back to login
          </button>
        </p>
      </section>
    </main>
  )
}
