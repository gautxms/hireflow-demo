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

  if (loading) return <div style={{ padding: '24px' }}>Loading account...</div>
  if (error) return <div style={{ padding: '24px' }}>Error: {error}</div>

  return (
    <main
      style={{
        maxWidth: '1000px',
        margin: '0 auto',
        padding: '40px 20px',
      }}
    >
      <h1 style={{ marginBottom: '40px', fontSize: '32px', fontWeight: '700' }}>Account Settings</h1>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '20px',
          marginBottom: '40px',
        }}
      >
        <ProfileCard user={userData} token={token} onRefresh={fetchUserData} />
        <SubscriptionCard user={userData} token={token} onRefresh={fetchUserData} />
        <BillingCard user={userData} token={token} />
      </div>

      <div
        style={{
          background: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          padding: '20px',
          marginTop: '40px',
        }}
      >
        <h3 style={{ color: '#991b1b', marginBottom: '15px' }}>Danger Zone</h3>
        <button
          onClick={() => {
            if (window.confirm('Are you sure? This cannot be undone.')) {
              deleteAccount()
            }
          }}
          style={{
            background: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            padding: '12px 24px',
            cursor: 'pointer',
            fontWeight: '600',
          }}
        >
          Delete Account
        </button>
      </div>
    </main>
  )
}
