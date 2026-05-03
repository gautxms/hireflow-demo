import { useEffect, useMemo, useState } from 'react'
import BackButton from '../components/BackButton'
import BrandLogo from '../components/BrandLogo'
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
  const [status, setStatus] = useState(email ? 'verifying' : 'error')
  const [message, setMessage] = useState(email ? 'Verifying your email…' : 'Invalid verification link. Email was not found in the URL.')

  useEffect(() => {
    let isMounted = true
    let redirectTimer

    if (!email) return () => {
      isMounted = false
      if (redirectTimer) {
        window.clearTimeout(redirectTimer)
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
        <BrandLogo as="p" className="auth-brand" />
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">Please wait while we validate your verification link.</p>

        {status === 'verifying' && <p className="auth-subtitle auth-status">{message}</p>}
        {status === 'success' && <p className="auth-success auth-status">{message}</p>}
        {status === 'error' && <p className="auth-error auth-status">{message}</p>}

        {(status === 'success' || status === 'error') && (
          <p className="auth-switch">
            <button className="auth-link" type="button" onClick={onGoToLogin}>
              Go to log in
            </button>
          </p>
        )}
      </section>
    </main>
  )
}
