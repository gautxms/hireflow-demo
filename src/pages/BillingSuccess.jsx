import { useEffect, useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import '../styles/billing.css'
import '../styles/checkout.css'
import BillingStatusLayout from '../components/BillingStatusLayout'
import API_BASE from '../config/api'
import { hasActiveSubscription } from '../utils/routeGuards'

const CREATE_ANALYSIS_INTENT_STORAGE_KEY = 'hireflow_create_analysis_intent'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const SUBSCRIPTION_POLL_TIMEOUT_MS = 60000
const SUBSCRIPTION_POLL_INTERVAL_MS = 2000

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
  const [finalizingStatus, setFinalizingStatus] = useState('polling')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let isMounted = true
    let pollTimer = 0
    let timeoutTimer = 0

    const persistSubscriptionState = (user) => {
      const subscriptionStatus = user?.subscription_status || 'inactive'
      localStorage.setItem('subscription_status', subscriptionStatus)
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user || null))
      window.dispatchEvent(new CustomEvent('hireflow-auth-updated'))
    }

    const pollSubscriptionStatus = async () => {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)

      if (!token) {
        setFinalizingStatus('timed-out')
        return
      }

      try {
        const response = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (response.ok) {
          const user = await response.json()
          const subscriptionStatus = user?.subscription_status || 'inactive'

          if (hasActiveSubscription(subscriptionStatus)) {
            persistSubscriptionState(user)
            if (isMounted) {
              setFinalizingStatus('active')
            }
            return
          }
        }
      } catch (error) {
        console.error('[BillingSuccess] Subscription finalization poll failed:', error)
      }

      if (isMounted) {
        pollTimer = window.setTimeout(pollSubscriptionStatus, SUBSCRIPTION_POLL_INTERVAL_MS)
      }
    }

    pollSubscriptionStatus()
    timeoutTimer = window.setTimeout(() => {
      if (isMounted) {
        window.clearTimeout(pollTimer)
        setFinalizingStatus((currentStatus) => (currentStatus === 'active' ? currentStatus : 'timed-out'))
      }
    }, SUBSCRIPTION_POLL_TIMEOUT_MS)

    return () => {
      isMounted = false
      window.clearTimeout(pollTimer)
      window.clearTimeout(timeoutTimer)
    }
  }, [retryCount])

  useEffect(() => {
    if (finalizingStatus !== 'active') {
      return undefined
    }

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
  }, [finalizingStatus])

  const isFinalizing = finalizingStatus === 'polling'
  const isTimedOut = finalizingStatus === 'timed-out'

  return (
    <BillingStatusLayout
      status={isTimedOut ? 'warning' : 'success'}
      title={isTimedOut ? 'Subscription still finalizing' : 'Payment successful'}
      subtitle={isTimedOut
        ? 'Payment completed, but we are still finalizing your subscription. Please refresh or contact support.'
        : message || (isFinalizing ? 'Finalizing subscription...' : 'Thank you for your subscription. Your account is now active.')}
      details={(
        <>
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
        </>
      )}
      footer={isFinalizing ? 'Finalizing subscription...' : isTimedOut ? 'Your payment was received. We will keep checking when you retry.' : `Redirecting to resume uploader in ${countdown} seconds...`}
      actions={isTimedOut ? (
        <button
          type="button"
          onClick={() => {
            setCountdown(5)
            setFinalizingStatus('polling')
            setRetryCount((currentRetryCount) => currentRetryCount + 1)
          }}
          className="hf-btn hf-btn--primary"
        >
          Retry finalizing subscription
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            markCreateAnalysisIntent()
            navigate('/uploader', { replace: true })
          }}
          className="hf-btn hf-btn--primary"
          disabled={isFinalizing}
        >
          {isFinalizing ? 'Finalizing subscription...' : 'Go to Resume Uploader'}
        </button>
      )}
    />
  )
}
