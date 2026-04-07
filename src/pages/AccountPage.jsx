import { useEffect, useState } from 'react'
import ProfileCard from '../components/ProfileCard'
import SubscriptionCard from '../components/SubscriptionCard'
import BillingCard from '../components/BillingCard'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export default function AccountPage({ token, user, onLogout }) {
  const [loading, setLoading] = useState(true)
  const [userData, setUserData] = useState(null)
  const [error, setError] = useState('')

  const fetchUserData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch user data')
      }

      const data = await response.json()
      setUserData(data.user || data)
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
      const response = await fetch(`${API_BASE_URL}/api/auth/delete-account`, {
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
      <div style={{ background: '#0a0a0a', color: '#a3a3a3', minHeight: '100vh', padding: '24px' }}>
        Loading account...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ background: '#0a0a0a', color: '#ef4444', minHeight: '100vh', padding: '24px' }}>
        Error: {error}
      </div>
    )
  }

  return (
    <main
      style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '60px 20px',
        background: '#0a0a0a',
        minHeight: '100vh',
      }}
    >
      <div style={{ marginBottom: '60px' }}>
        <h1
          style={{
            fontSize: '40px',
            fontWeight: '700',
            color: '#ffffff',
            marginBottom: '12px',
          }}
        >
          Account Settings
        </h1>
        <p
          style={{
            fontSize: '16px',
            color: '#a3a3a3',
          }}
        >
          Manage your profile, subscription, and billing preferences
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
          gap: '24px',
          marginBottom: '60px',
        }}
      >
        <ProfileCard user={userData} token={token} onRefresh={fetchUserData} />
        <SubscriptionCard user={userData} token={token} onRefresh={fetchUserData} />
        <BillingCard user={userData} token={token} />
      </div>

      <div
        style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '12px',
          padding: '32px',
          marginTop: '60px',
        }}
      >
        <h3
          style={{
            color: '#ef4444',
            marginBottom: '16px',
            fontSize: '18px',
            fontWeight: '600',
          }}
        >
          Danger Zone
        </h3>
        <p
          style={{
            color: '#a3a3a3',
            marginBottom: '20px',
            lineHeight: '1.6',
          }}
        >
          Once you delete your account, there is no going back. Please be certain.
        </p>
        <button
          onClick={() => {
            if (window.confirm('Are you absolutely sure? This action cannot be undone.')) {
              deleteAccount()
            }
          }}
          style={{
            background: '#ef4444',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '12px 24px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '14px',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(event) => {
            event.target.style.background = '#dc2626'
          }}
          onMouseLeave={(event) => {
            event.target.style.background = '#ef4444'
          }}
        >
          Delete Account
        </button>
      </div>
    </main>
  )
}
