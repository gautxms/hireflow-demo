import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

export default function AdminUserDetailPage({ token, userId }) {
  const [user, setUser] = useState(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadUser = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        setError(payload?.error || `Unable to load user (${response.status})`)
        return
      }

      setUser(payload.user)
      setReason(payload.user.blocked_reason || '')
    } catch {
      setError('Unable to reach admin API')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUser()
  }, [userId])

  const handleBlockToggle = async () => {
    if (!user) {
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          isBlocked: !user.is_blocked,
          reason,
        }),
      })

      const payload = await parseResponsePayload(response)

      if (!response.ok) {
        setError(payload?.error || `Unable to update user (${response.status})`)
        return
      }

      setUser({ ...user, ...payload.user, subscription_status: user.subscription_status })
    } catch {
      setError('Unable to update block status')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 700, margin: '0 auto' }}>
      <h1>Admin • User Details</h1>
      <button onClick={() => navigate('/admin/users')} style={{ marginBottom: 16 }}>Back to users</button>

      {loading && <p>Loading user...</p>}
      {error && <p style={{ color: '#b42318' }}>{error}</p>}

      {user && (
        <section style={{ border: '1px solid #e4e7ec', borderRadius: 8, padding: 16 }}>
          <p><strong>Email:</strong> {user.email}</p>
          <p><strong>Role:</strong> {user.role}</p>
          <p><strong>Subscription:</strong> {user.subscription_status}</p>
          <p><strong>Status:</strong> {user.is_blocked ? 'Blocked' : 'Active'}</p>

          <label htmlFor="blocked-reason" style={{ display: 'block', marginBottom: 6 }}>
            Block reason
          </label>
          <textarea
            id="blocked-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Optional reason"
            style={{ width: '100%', padding: 8, marginBottom: 12 }}
          />

          <button onClick={handleBlockToggle} disabled={saving}>
            {saving ? 'Saving...' : user.is_blocked ? 'Unblock user' : 'Block user'}
          </button>
        </section>
      )}
    </main>
  )
}
