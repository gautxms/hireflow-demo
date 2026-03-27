import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export default function VerifyEmail() {
  const [status, setStatus] = useState('verifying') // 'verifying', 'success', 'error'
  const [message, setMessage] = useState('Verifying your email...')
  const searchParams = new URLSearchParams(window.location.search)
  const token = searchParams.get('token')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('No verification token provided in link.')
      return
    }

    // Call backend to verify email
    const verifyEmail = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`)

        if (response.ok) {
          setStatus('success')
          setMessage('✓ Your email has been verified! Redirecting to login...')
          
          // Redirect to login after 2 seconds
          setTimeout(() => {
            window.location.href = '/login'
          }, 2000)
        } else {
          const data = await response.json().catch(() => ({ error: 'Verification failed' }))
          setStatus('error')
          setMessage(`Error: ${data.error || 'Verification failed'}`)
        }
      } catch (error) {
        setStatus('error')
        setMessage(`Connection error: ${error.message}`)
      }
    }

    verifyEmail()
  }, [token])

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {status === 'verifying' && (
          <>
            <div style={styles.spinner} />
            <p style={styles.text}>{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={styles.checkmark}>✓</div>
            <p style={styles.text}>{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={styles.errorIcon}>✗</div>
            <p style={styles.text}>{message}</p>
            <a href="/signup" style={styles.link}>Try signing up again</a>
          </>
        )}
      </div>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#f9fafb'
  },
  card: {
    background: 'white',
    padding: '40px',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    textAlign: 'center',
    maxWidth: '400px'
  },
  spinner: {
    width: '50px',
    height: '50px',
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #0f172a',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 20px'
  },
  checkmark: {
    fontSize: '60px',
    color: '#22c55e',
    marginBottom: '20px'
  },
  errorIcon: {
    fontSize: '60px',
    color: '#ef4444',
    marginBottom: '20px'
  },
  text: {
    fontSize: '16px',
    color: '#333',
    marginBottom: '20px',
    lineHeight: '1.6'
  },
  link: {
    color: '#0f172a',
    textDecoration: 'none',
    fontWeight: '600'
  }
}
