import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ProfileCard from '../components/ProfileCard'
import SubscriptionCard from '../components/SubscriptionCard'
import BillingCard from '../components/BillingCard'
import StatePattern from '../components/state/StatePattern'
import API_BASE from '../config/api'
import '../styles/account.css'
import '../styles/checkout.css'

function normalizeUserPayload(payload) {
  return payload?.user || payload || null
}

function getUserKey(user) {
  return user?.id || user?.email || ''
}

function isAbortError(error) {
  return error?.name === 'AbortError'
}

export default function AccountPage({ token, user, onLogout, onUserProfileUpdate }) {
  const fallbackUser = useMemo(() => user || null, [user])
  const [loading, setLoading] = useState(true)
  const [userData, setUserData] = useState(() => fallbackUser)
  const [subscriptionData, setSubscriptionData] = useState(null)
  const [fatalError, setFatalError] = useState('')
  const [refreshWarning, setRefreshWarning] = useState('')
  const stableUserKey = getUserKey(user)
  const hasDisplayableUser = Boolean(userData || fallbackUser)
  const hasDisplayableUserRef = useRef(hasDisplayableUser)
  const userRef = useRef(user)
  const onLogoutRef = useRef(onLogout)
  const onUserProfileUpdateRef = useRef(onUserProfileUpdate)
  const requestSequenceRef = useRef(0)
  const activeRequestControllerRef = useRef(null)
  const authenticatedScopeRef = useRef('')

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    onLogoutRef.current = onLogout
  }, [onLogout])

  useEffect(() => {
    onUserProfileUpdateRef.current = onUserProfileUpdate
  }, [onUserProfileUpdate])

  useEffect(() => {
    hasDisplayableUserRef.current = hasDisplayableUser
  }, [hasDisplayableUser])

  const isLatestRequest = useCallback((requestId, controller) => {
    return requestSequenceRef.current === requestId && !controller.signal.aborted
  }, [])

  const handleExpiredSession = useCallback(() => {
    onLogoutRef.current?.('Your session expired while you were away. Please log in again.')
    window.location.href = '/login'
  }, [])

  const fetchUserData = useCallback(async ({ isInitialLoad = false } = {}) => {
    if (!token) {
      handleExpiredSession()
      return
    }

    activeRequestControllerRef.current?.abort()
    const controller = new AbortController()
    activeRequestControllerRef.current = controller
    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId

    if (isInitialLoad && !hasDisplayableUserRef.current) {
      setLoading(true)
    }

    let nextWarning = ''

    try {
      const [userResult, subscriptionResult] = await Promise.allSettled([
        fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }),
        fetch(`${API_BASE}/subscriptions/current`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }),
      ])

      if (!isLatestRequest(requestId, controller)) {
        return
      }

      if (userResult.status === 'rejected') {
        if (isAbortError(userResult.reason)) return
        throw new Error('Failed to fetch user data')
      }

      const userResponse = userResult.value

      if (!isLatestRequest(requestId, controller)) {
        return
      }

      if (userResponse.status === 401) {
        handleExpiredSession()
        return
      }

      if (!userResponse.ok) {
        throw new Error('Failed to fetch user data')
      }

      const userPayload = await userResponse.json().catch((error) => {
        if (isAbortError(error)) return null
        return null
      })

      if (!isLatestRequest(requestId, controller)) {
        return
      }

      const normalizedUser = normalizeUserPayload(userPayload)

      if (!normalizedUser) {
        throw new Error('Failed to fetch user data')
      }

      setUserData(normalizedUser)
      onUserProfileUpdateRef.current?.(normalizedUser)
      setFatalError('')

      if (subscriptionResult.status === 'fulfilled') {
        const subscriptionResponse = subscriptionResult.value
        const subscriptionPayload = await subscriptionResponse.json().catch((error) => {
          if (isAbortError(error)) return {}
          return {}
        })

        if (!isLatestRequest(requestId, controller)) {
          return
        }

        if (subscriptionResponse.status === 401) {
          handleExpiredSession()
          return
        }

        if (subscriptionResponse.ok) {
          setSubscriptionData(subscriptionPayload.subscription || null)
        } else {
          console.error('[AccountPage] Failed to load subscription details:', subscriptionPayload.error || subscriptionResponse.statusText)
          nextWarning = 'We could not refresh subscription details. Showing the safest available account view.'
        }
      } else {
        if (isAbortError(subscriptionResult.reason)) return
        console.error('[AccountPage] Failed to load subscription details:', subscriptionResult.reason)
        nextWarning = 'We could not refresh subscription details. Showing the safest available account view.'
      }
    } catch (err) {
      if (isAbortError(err) || !isLatestRequest(requestId, controller)) {
        return
      }

      const message = err.message || 'Failed to load account'
      if (isInitialLoad && !hasDisplayableUserRef.current) {
        setFatalError(message)
      } else {
        nextWarning = 'We could not refresh account data. Showing last loaded details.'
      }
    } finally {
      if (isLatestRequest(requestId, controller)) {
        setRefreshWarning(nextWarning)
        setLoading(false)
        if (activeRequestControllerRef.current === controller) {
          activeRequestControllerRef.current = null
        }
      }
    }
  }, [handleExpiredSession, isLatestRequest, token])

  useEffect(() => {
    const currentUser = userRef.current

    if (!currentUser || !token) {
      window.location.href = '/login'
      return
    }

    const nextAuthenticatedScope = `${token}:${getUserKey(currentUser)}`
    const didAuthenticatedScopeChange = authenticatedScopeRef.current !== nextAuthenticatedScope

    if (didAuthenticatedScopeChange) {
      activeRequestControllerRef.current?.abort()
      requestSequenceRef.current += 1
      authenticatedScopeRef.current = nextAuthenticatedScope
      setSubscriptionData(null)
      setFatalError('')
      setRefreshWarning('')
      setLoading(true)
    }

    setUserData(currentUser)
    if (!didAuthenticatedScopeChange) {
      setFatalError('')
      setRefreshWarning('')
    }
    fetchUserData({ isInitialLoad: didAuthenticatedScopeChange })

    return () => {
      activeRequestControllerRef.current?.abort()
    }
  }, [fetchUserData, stableUserKey, token])

  const deleteAccount = async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/delete-account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        handleExpiredSession()
        return
      }

      if (!response.ok) {
        throw new Error('Failed to delete account')
      }

      onLogout()
      window.location.href = '/goodbye'
    } catch {
      setRefreshWarning('Failed to delete account')
    }
  }

  if (loading && !hasDisplayableUser) {
    return (
      <div className="account-page__loading route-state">
        <StatePattern
          kind="loading"
          title="Loading account…"
          description="Please wait while we load your profile and billing details."
        />
      </div>
    )
  }

  if (!loading && fatalError && !hasDisplayableUser) {
    return (
      <div className="account-page__error route-state route-state--shared-error">
        <StatePattern
          kind="error"
          title="Account unavailable"
          description={`Error: ${fatalError}`}
          action={<button type="button" className="route-state-card__action" onClick={() => fetchUserData({ isInitialLoad: true })}>Retry</button>}
        />
      </div>
    )
  }

  const displayUser = userData || fallbackUser

  return (
    <main className="account-page">
      <div className="account-page__header">
        <h1 className="account-page__title">Account Settings</h1>
        <p className="account-page__subtitle">Manage your profile, subscription, and billing preferences</p>
      </div>

      {refreshWarning ? (
        <StatePattern
          kind="error"
          compact
          className="account-page__warning"
          title="Account data may be out of date"
          description={refreshWarning}
          action={<button type="button" className="route-state-card__action" onClick={() => fetchUserData()}>Retry</button>}
        />
      ) : null}

      <div className="account-page__grid">
        <ProfileCard user={displayUser} token={token} onRefresh={() => fetchUserData()} />
        <SubscriptionCard user={displayUser} token={token} onRefresh={() => fetchUserData()} subscription={subscriptionData} />
        <BillingCard user={displayUser} subscription={subscriptionData} />
      </div>

      <div className="account-page__danger-zone">
        <h3 className="account-page__danger-title">Danger Zone</h3>
        <p className="account-page__danger-description">Once you delete your account, there is no going back. Please be certain.</p>
        <button
          className="hf-btn hf-btn--destructive"
          onClick={() => {
            if (window.confirm('Are you absolutely sure? This action cannot be undone.')) {
              deleteAccount()
            }
          }}
        >
          Delete Account
        </button>
      </div>
    </main>
  )
}
