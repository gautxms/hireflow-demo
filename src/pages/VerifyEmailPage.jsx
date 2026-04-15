import { useEffect, useMemo, useState } from 'react'
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

export default function VerifyEmailPage({ onGoToLogin }) {
  const email = useMemo(() => new URLSearchParams(window.location.search).get('email') || '', [])
  const [status, setStatus] = useState('verifying')
  const [message, setMessage] = useState('Verifying your email...')

  useEffect(() => {
    let isMounted = true
    let redirectTimer

    if (!email) {
      setStatus('error')
      setMessage('Invalid verification link. Email was not found in the URL.')
      return () => {
        isMounted = false
        if (redirectTimer) {
          window.clearTimeout(redirectTimer)
        }
      }
    }

    async function verifyEmail() {
      try {
        const response = await fetch(`${API_BASE}/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email }),
        })

        const payload = await parseResponsePayload(response)

        if (!isMounted) {
          return
        }

        if (!response.ok) {
          setStatus('error')
          setMessage(payload?.error || `Verification failed (${response.status})`)
          return
        }

        setStatus('success')
        setMessage(payload?.message || 'Email verified! Redirecting to login...')
        redirectTimer = window.setTimeout(() => {
          onGoToLogin()
        }, 2000)
      } catch {
        if (isMounted) {
          setStatus('error')
          setMessage('Unable to verify email right now. Please try again.')
        }
      }
    }

    verifyEmail()

    return () => {
      isMounted = false
      if (redirectTimer) {
        window.clearTimeout(redirectTimer)
      }
    }
  }, [email, onGoToLogin])

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow--a" />
      <div className="auth-glow auth-glow--b" />
      <section className="auth-panel">
        <BackButton />
        <p className="auth-brand">Hire<span>Flow</span></p>
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">Please wait while we validate your verification link.</p>

        {status === 'verifying' && <p>{message}</p>}
        {status === 'success' && <p className="auth-success">{message}</p>}
        {status === 'error' && <p className="auth-error">{message}</p>}

        {(status === 'success' || status === 'error') && (
          <p className="auth-switch">
            <button className="auth-link" type="button" onClick={onGoToLogin}>
              Go to login
            </button>
          </p>
        )}
      </section>
    </main>
  )
}
