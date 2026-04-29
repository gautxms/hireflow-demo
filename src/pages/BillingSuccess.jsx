import { useEffect, useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import '../styles/billing.css'
import '../styles/checkout.css'

const CREATE_ANALYSIS_INTENT_STORAGE_KEY = 'hireflow_create_analysis_intent'


function markCreateAnalysisIntent() {
  const intent = {
    id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  }
  sessionStorage.setItem(CREATE_ANALYSIS_INTENT_STORAGE_KEY, JSON.stringify(intent))
}

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
          markCreateAnalysisIntent()
          navigate('/uploader', { replace: true })
          return 0
        }

        return previousCountdown - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <main className="billing-shell billing-shell--centered route-state">
      <div className="billing-shell__card billing-shell__card--success route-state-card">
        <div className="billing-shell__icon-wrap">✓</div>

        <h1 className="billing-shell__title billing-shell__title--success">Payment Successful!</h1>

        <p className="billing-shell__message">{message || 'Thank you for your subscription. Your account is now active.'}</p>

        <div className="billing-shell__summary">
          <div className="billing-shell__summary-row">
            <span className="billing-shell__summary-label">Plan:</span>
            <strong className="billing-shell__summary-value">{plan}</strong>
          </div>
          {transactionId && (
            <div className="billing-shell__summary-row billing-shell__summary-row--transaction">
              <span className="billing-shell__summary-label">Transaction:</span>
              <code className="billing-shell__transaction">{transactionId}</code>
            </div>
          )}
        </div>

        <p className="billing-shell__countdown">Redirecting to resume uploader in {countdown} seconds...</p>

        <button
          type="button"
          onClick={() => {
            markCreateAnalysisIntent()
            navigate('/uploader', { replace: true })
          }}
          className="hf-btn hf-btn--primary"
        >
          Go to Resume Uploader
        </button>
      </div>
    </main>
  )
}
