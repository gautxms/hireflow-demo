import { useEffect, useState } from 'react'
import { CheckCircle2, CircleX, MailCheck } from 'lucide-react'
import BackButton from '../components/BackButton'
import BrandLogo from '../components/BrandLogo'
import '../components/AuthPage.css'
import API_BASE from '../config/api'

export default function VerifyEmail() {
  const searchParams = new URLSearchParams(window.location.search)
  const token = searchParams.get('token')
  const [status, setStatus] = useState(token ? 'verifying' : 'error')
  const [message, setMessage] = useState(token ? 'Verifying your email…' : 'No verification token provided in this link.')

  useEffect(() => {
    if (!token) return

    const verifyEmail = async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`)

        if (response.ok) {
          setStatus('success')
          setMessage('Your email has been verified. Redirecting to log in…')

          setTimeout(() => {
            window.location.href = '/login'
          }, 2000)
        } else {
          const data = await response.json().catch(() => ({ error: 'Verification failed.' }))
          setStatus('error')
          setMessage(data.error || 'Verification failed.')
        }
      } catch (error) {
        setStatus('error')
        setMessage(`Connection error: ${error.message}`)
      }
    }

    verifyEmail()
  }, [token])

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow--a" />
      <div className="auth-glow auth-glow--b" />
      <section className="auth-panel">
        <BackButton />
        <BrandLogo as="p" className="auth-brand" />
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">Please wait while we validate your verification link.</p>

        {status === 'verifying' && (
          <p className="auth-subtitle auth-status"><MailCheck size={18} strokeWidth={1.5} /> {message}</p>
        )}
        {status === 'success' && (
          <p className="auth-success auth-status"><CheckCircle2 size={18} strokeWidth={1.5} /> {message}</p>
        )}
        {status === 'error' && (
          <>
            <p className="auth-error auth-status"><CircleX size={18} strokeWidth={1.5} /> {message}</p>
            <p className="auth-switch">
              <a href="/signup" className="auth-link">Try signing up again</a>
            </p>
          </>
        )}
      </section>
    </main>
  )
}
