import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const E164_REGEX = /^\+[1-9]\d{1,14}$/

function Toast({ type, message }) {
  if (!message) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        padding: '0.75rem 1rem',
        borderRadius: 8,
        color: '#fff',
        background: type === 'error' ? '#b91c1c' : '#166534',
        zIndex: 50,
      }}
    >
      {message}
    </div>
  )
}

export default function AccountSettingsPage() {
  const [profile, setProfile] = useState(null)
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [toast, setToast] = useState({ type: 'success', message: '' })
  const [loading, setLoading] = useState(true)

  const token = useMemo(() => localStorage.getItem(TOKEN_STORAGE_KEY), [])

  const pushToast = (type, message) => {
    setToast({ type, message })
    window.setTimeout(() => setToast({ type: 'success', message: '' }), 2800)
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  async function loadProfile() {
    if (!token) {
      pushToast('error', 'Please log in first.')
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/profile/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load account (${response.status})`)
      }

      setProfile(payload.user)
      setCompany(payload.user.company || '')
      setPhone(payload.user.phone || '')
    } catch (error) {
      pushToast('error', error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [])

  const handleProfileSave = async (event) => {
    event.preventDefault()

    if (phone.trim() && !E164_REGEX.test(phone.trim())) {
      pushToast('error', 'Phone must use E.164 format (example: +14155552671).')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/profile/me`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ company, phone }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to update profile')
      }

      setProfile(payload.user)
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(payload.user))
      pushToast('success', 'Profile updated successfully.')
    } catch (error) {
      pushToast('error', error.message)
    }
  }

  const handlePasswordChange = async (event) => {
    event.preventDefault()

    if (newPassword !== confirmPassword) {
      pushToast('error', 'New password and confirmation must match.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/profile/change-password`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to change password')
      }

      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      pushToast('success', 'Password changed successfully.')
    } catch (error) {
      pushToast('error', error.message)
    }
  }

  const handleDownloadData = async () => {
    try {
      const response = await fetch(`${API_BASE}/profile/export`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to export personal data')
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `hireflow-personal-data-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)

      pushToast('success', 'Personal data downloaded.')
    } catch (error) {
      pushToast('error', error.message)
    }
  }

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm('Are you sure? Your account will be scheduled for deletion after a 30-day grace period.')
    if (!confirmed) return

    try {
      const response = await fetch(`${API_BASE}/profile/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to schedule deletion')
      }

      setProfile((current) => ({ ...current, deleted_at: payload.deleted_at, deletion_scheduled_for: payload.deletion_scheduled_for }))
      pushToast('success', 'Account deletion scheduled with a 30-day grace period.')
    } catch (error) {
      pushToast('error', error.message)
    }
  }

  if (loading) {
    return <div className="type-body" style={{ padding: '2rem' }}>Loading account settings...</div>
  }

  if (!profile) {
    return <div className="type-body" style={{ padding: '2rem' }}>Unable to load profile.</div>
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1rem 3rem', color: 'var(--text)' }}>
      <Toast type={toast.type} message={toast.message} />
      <h1 className="type-h1" style={{ marginBottom: '0.5rem' }}>Account Settings</h1>
      <p className="type-body" style={{ color: 'var(--muted)', marginBottom: '1.75rem' }}>Manage your profile and security settings.</p>

      <section style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)', padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 className="type-h2" style={{ marginTop: 0 }}>Profile</h2>
        <form onSubmit={handleProfileSave} style={{ display: 'grid', gap: '0.9rem' }}>
          <label>
            Company
            <input value={company} onChange={(event) => setCompany(event.target.value)} maxLength={100} style={{ width: '100%', marginTop: 6 }} />
          </label>
          <label>
            Phone (E.164)
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+14155552671" style={{ width: '100%', marginTop: 6 }} />
          </label>
          <label>
            Email (read-only)
            <input value={profile.email || ''} disabled style={{ width: '100%', marginTop: 6, opacity: 0.7 }} />
          </label>
          <label>
            Subscription Status (read-only)
            <input value={profile.subscription_status || 'inactive'} disabled style={{ width: '100%', marginTop: 6, opacity: 0.7 }} />
          </label>
          <div className="type-small" style={{ color: 'var(--muted)' }}>
            To change subscription, visit <a href="/pricing">Billing</a>.
          </div>
          <div className="type-small" style={{ color: 'var(--muted)' }}>
            Account created: {profile.created_at ? new Date(profile.created_at).toLocaleString() : 'Unknown'}
          </div>
          <button type="submit" className="type-button" style={{ width: 'fit-content' }}>Save profile</button>
        </form>
      </section>

      <section style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)', padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 className="type-h2" style={{ marginTop: 0 }}>Change Password</h2>
        <form onSubmit={handlePasswordChange} style={{ display: 'grid', gap: '0.9rem' }}>
          <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} placeholder="Old password" required />
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" required minLength={8} />
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm new password" required minLength={8} />
          <button type="submit" className="type-button" style={{ width: 'fit-content' }}>Change password</button>
        </form>
      </section>

      <section style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)', padding: '1.2rem' }}>
        <h2 className="type-h2" style={{ marginTop: 0 }}>Privacy & Data</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="type-button" onClick={handleDownloadData}>Download personal data (JSON)</button>
          <button className="type-button" onClick={handleDeleteAccount} style={{ background: '#dc2626', color: '#fff' }}>Delete account</button>
        </div>
        {profile.deletion_scheduled_for && (
          <p className="type-small" style={{ marginTop: 12, color: '#fca5a5' }}>
            Deletion scheduled for: {new Date(profile.deletion_scheduled_for).toLocaleString()}
          </p>
        )}
      </section>
    </main>
  )
}
