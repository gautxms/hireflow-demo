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
    message: historyState.message || '',
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
      background: '#0a0a0a',
      padding: '20px',
    }}>
      <div style={{
        background: '#1a1a1a',
        border: '2px solid #CCFF00',
        borderRadius: '16px',
        padding: '60px 40px',
        textAlign: 'center',
        width: '100%',
        maxWidth: '500px',
        boxShadow: '0 20px 60px rgba(204, 255, 0, 0.1)',
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          background: '#CCFF00',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 30px',
          animation: 'scaleIn 0.6s ease-out',
          color: '#000000',
          fontSize: '40px',
        }}>
          ✓
        </div>

        <h1 style={{
          fontSize: 'clamp(1.8rem, 4vw, 32px)',
          fontWeight: '700',
          marginBottom: '12px',
          color: '#CCFF00',
        }}>
          Payment Successful!
        </h1>

        <p style={{
          fontSize: '16px',
          color: '#a3a3a3',
          marginBottom: '30px',
          lineHeight: '1.6',
        }}>
          {message || 'Thank you for your subscription. Your account is now active.'}
        </p>

        <div style={{
          background: '#0a0a0a',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '30px',
          border: '1px solid #333333',
          textAlign: 'left',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '12px',
            paddingBottom: '12px',
            borderBottom: '1px solid #333333',
          }}>
            <span style={{ color: '#a3a3a3' }}>Plan:</span>
            <strong style={{ color: '#CCFF00', textTransform: 'capitalize' }}>
              {plan}
            </strong>
          </div>
          {transactionId && (
            <div>
              <span style={{ color: '#a3a3a3' }}>Transaction:</span>
              <code style={{
                display: 'block',
                marginTop: '8px',
                color: '#ffffff',
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
          color: '#a3a3a3',
          marginBottom: '20px',
        }}>
          Redirecting to resume uploader in {countdown} seconds...
        </p>

        <button
          type="button"
          onClick={() => navigate('/uploader', { replace: true })}
          style={{
            background: '#CCFF00',
            color: '#000000',
            border: 'none',
            borderRadius: '6px',
            padding: '14px 32px',
            fontSize: '16px',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          Go to Resume Uploader
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
