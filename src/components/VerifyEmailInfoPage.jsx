import { useEffect, useMemo, useState } from 'react'
import './AuthPage.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, totalSeconds)
  const minutesPortion = Math.floor(seconds / 60)
  const secondsPortion = seconds % 60

  return `${minutesPortion}:${secondsPortion.toString().padStart(2, '0')}`
}

export default function VerifyEmailInfoPage({ onBackToLogin, email = '' }) {
  const [resendEmail, setResendEmail] = useState(email)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  useEffect(() => {
    setResendEmail(email)
  }, [email])

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setCooldownSeconds((seconds) => (seconds > 0 ? seconds - 1 : 0))
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [cooldownSeconds])

  const countdownLabel = useMemo(() => formatCountdown(cooldownSeconds), [cooldownSeconds])

  const handleResendVerification = async () => {
    setError('')
    setStatusMessage('')

    const normalizedEmail = resendEmail.trim().toLowerCase()

    if (!normalizedEmail) {
      setError('Please enter the email used during signup')
      return
    }

    if (cooldownSeconds > 0) {
      setError(`Please wait ${countdownLabel} before trying again`)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/resend-email-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail }),
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        const retryAfterSeconds = Number(payload?.retryAfterSeconds || 0)

        if (response.status === 429 && retryAfterSeconds > 0) {
          setCooldownSeconds(retryAfterSeconds)
          setError(`Please wait ${formatCountdown(retryAfterSeconds)} before resending`)
          return
        }

        setError(payload?.error || `Unable to resend verification email (${response.status})`)
        return
      }

      const nextCooldownSeconds = Number(payload?.retryAfterSeconds || 60)
      setCooldownSeconds(nextCooldownSeconds)
      setStatusMessage(payload?.message || 'Email sent! Check your inbox')
    } catch {
      setError('Unable to connect to auth server. Check backend URL / CORS settings.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow--a" />
      <div className="auth-glow auth-glow--b" />
      <section className="auth-panel">
        <p className="auth-brand">Hire<span>Flow</span></p>
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">Check your email to verify your account before logging in.</p>

        <div className="auth-form">
          <label className="auth-label" htmlFor="resend-verification-email">Email</label>
          <input
            id="resend-verification-email"
            className="auth-input"
            type="email"
            autoComplete="email"
            value={resendEmail}
            onChange={(event) => setResendEmail(event.target.value)}
            placeholder="you@company.com"
          />

          <button
            className="auth-submit"
            type="button"
            onClick={handleResendVerification}
            disabled={isSubmitting || cooldownSeconds > 0}
          >
            {isSubmitting
              ? 'Sending...'
              : cooldownSeconds > 0
                ? `Resend available in ${countdownLabel}`
                : 'Resend verification email'}
          </button>

          {statusMessage && <p className="auth-success">{statusMessage}</p>}
          {error && <p className="auth-error">{error}</p>}

          <p className="auth-subtitle auth-help-text">If you don't see email, check spam folder.</p>
        </div>

        <p className="auth-switch">
          <button className="auth-link" type="button" onClick={onBackToLogin}>Back to Login</button>
        </p>
      </section>
    </main>
  )
}
