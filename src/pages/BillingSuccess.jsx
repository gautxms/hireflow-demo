import { useEffect, useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'

function navigate(pathname, options = {}) {
  if (window.location.pathname !== pathname) {
    window.history.pushState(options.state ?? {}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function getBillingState() {
  const historyState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}

  return {
    transactionId: historyState.transactionId || '',
    plan: historyState.plan || 'monthly',
    message: historyState.message || 'Payment successful!',
  }
}

export default function BillingSuccess() {
  usePageSeo('Billing Success', 'Your HireFlow subscription checkout completed successfully.')

  const { transactionId, plan, message } = useMemo(() => getBillingState(), [])
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((previousCountdown) => {
        if (previousCountdown <= 1) {
          window.clearInterval(timer)
          navigate('/uploader', { replace: true })
          return 0
        }

        return previousCountdown - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '1.25rem',
    }}>
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: 'min(60px, 10vw) min(40px, 7vw)',
        textAlign: 'center',
        width: '100%',
        maxWidth: '500px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          background: '#22c55e',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 30px',
          animation: 'scaleIn 0.6s ease-out',
        }}>
          <span style={{ fontSize: '40px', color: 'white' }}>✓</span>
        </div>

        <h1 style={{
          fontSize: 'clamp(1.6rem, 4vw, 1.75rem)',
          fontWeight: '700',
          marginBottom: '10px',
          color: '#1f2937',
        }}>
          {message}
        </h1>

        <p style={{
          fontSize: '16px',
          color: '#6b7280',
          marginBottom: '30px',
          lineHeight: '1.6',
        }}>
          Thank you for your subscription. Your account is now active and you can start uploading resumes.
        </p>

        <div style={{
          background: '#f3f4f6',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '30px',
          textAlign: 'left',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: transactionId ? '10px' : 0,
            gap: '12px',
          }}>
            <span style={{ color: '#6b7280' }}>Plan:</span>
            <strong style={{ color: '#1f2937', textTransform: 'capitalize' }}>{plan}</strong>
          </div>
          {transactionId && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
            }}>
              <span style={{ color: '#6b7280' }}>Transaction ID:</span>
              <code style={{
                color: '#1f2937',
                fontFamily: 'monospace',
                fontSize: '12px',
                wordBreak: 'break-all',
              }}>
                {transactionId}
              </code>
            </div>
          )}
        </div>

        <p style={{
          fontSize: '14px',
          color: '#9ca3af',
          marginBottom: '20px',
        }}>
          Redirecting to dashboard in {countdown} seconds...
        </p>

        <button
          type="button"
          onClick={() => navigate('/uploader', { replace: true })}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = '#764ba2'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = '#667eea'
          }}
          style={{
            background: '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
        >
          Go to Dashboard Now
        </button>

        <style>{`
          @keyframes scaleIn {
            from {
              transform: scale(0);
              opacity: 0;
            }
            to {
              transform: scale(1);
              opacity: 1;
            }
          }
        `}</style>
      </div>
    </main>
  )
}
