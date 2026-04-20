import { useEffect, useState } from 'react'
import ProfileCard from '../components/ProfileCard'
import SubscriptionCard from '../components/SubscriptionCard'
import BillingCard from '../components/BillingCard'
import API_BASE from '../config/api'
import '../styles/account.css'
import '../styles/checkout.css'

export default function AccountPage({ token, user, onLogout, onUserProfileUpdate }) {
  const [loading, setLoading] = useState(true)
  const [userData, setUserData] = useState(null)
  const [subscriptionData, setSubscriptionData] = useState(null)
  const [error, setError] = useState('')

  const fetchUserData = async () => {
    try {
      const [userResponse, subscriptionResponse] = await Promise.all([
        fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/subscriptions/current`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (!userResponse.ok) {
        throw new Error('Failed to fetch user data')
      }

      const userPayload = await userResponse.json()
      const subscriptionPayload = await subscriptionResponse.json().catch(() => ({}))
      const normalizedUser = userPayload.user || userPayload
      setUserData(normalizedUser)
      onUserProfileUpdate?.(normalizedUser)

      if (subscriptionResponse.ok) {
        setSubscriptionData(subscriptionPayload.subscription || null)
      } else {
        console.error('[AccountPage] Failed to load subscription details:', subscriptionPayload.error || subscriptionResponse.statusText)
        setSubscriptionData(null)
      }
      setError('')
    } catch (err) {
      setError(err.message || 'Failed to load account')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user || !token) {
      window.location.href = '/login'
      return
    }

    fetchUserData()
  }, [user, token])

  const deleteAccount = async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/delete-account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to delete account')
      }

      onLogout()
      window.location.href = '/goodbye'
    } catch {
      setError('Failed to delete account')
    }
  }

  if (loading) {
    return (
      <div className="account-page__loading route-state">
        <div className="route-state-card">
          <h1 className="route-state-card__title">Loading account…</h1>
          <p className="route-state-card__message">Please wait while we load your profile and billing details.</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="account-page__error route-state route-state--shared-error">
        <div className="route-state-card">
          <h1 className="route-state-card__title">Account unavailable</h1>
          <p className="route-state-card__message">Error: {error}</p>
        </div>
      </div>
    )
  }

  return (
    <main className="account-page">
      <div className="account-page__header">
        <h1 className="account-page__title">Account Settings</h1>
        <p className="account-page__subtitle">Manage your profile, subscription, and billing preferences</p>
      </div>

      <div className="account-page__grid">
        <ProfileCard user={userData} token={token} onRefresh={fetchUserData} />
        <SubscriptionCard user={userData} token={token} onRefresh={fetchUserData} subscription={subscriptionData} />
        <BillingCard user={userData} token={token} />
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
