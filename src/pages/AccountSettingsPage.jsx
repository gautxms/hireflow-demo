import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import '../styles/account-settings.css'

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
        color: 'var(--color-text-primary)',
        background: type === 'error' ? 'var(--color-error)' : 'var(--color-success)',
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
    return <div className="account-settings-page">Loading account settings...</div>
  }

  if (!profile) {
    return <div className="account-settings-page">Unable to load profile.</div>
  }

  return (
    <main className="account-settings-page">
      <Toast type={toast.type} message={toast.message} />
      <h1 className="account-settings-page__title">Account Settings</h1>
      <p className="account-settings-page__subtitle">Manage your profile and security settings.</p>

      <section className="account-settings-page__card">
        <h2 style={{ marginTop: 0 }}>Profile</h2>
        <form onSubmit={handleProfileSave} className="account-settings-page__form">
          <label>
            Company
            <input value={company} onChange={(event) => setCompany(event.target.value)} maxLength={100} className="account-settings-page__input" />
          </label>
          <label>
            Phone (E.164)
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+14155552671" className="account-settings-page__input" />
          </label>
          <label>
            Email (read-only)
            <input value={profile.email || ''} disabled className="account-settings-page__input account-settings-page__input--readonly" />
          </label>
          <label>
            Subscription Status (read-only)
            <input value={profile.subscription_status || 'inactive'} disabled className="account-settings-page__input account-settings-page__input--readonly" />
          </label>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            To change subscription, visit <a href="/pricing">Billing</a>.
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            Account created: {profile.created_at ? new Date(profile.created_at).toLocaleString() : 'Unknown'}
          </div>
          <button type="submit" style={{ width: 'fit-content' }}>Save profile</button>
        </form>
      </section>

      <section className="account-settings-page__card">
        <h2 style={{ marginTop: 0 }}>Change Password</h2>
        <form onSubmit={handlePasswordChange} className="account-settings-page__form">
          <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} placeholder="Old password" required />
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" required minLength={8} />
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm new password" required minLength={8} />
          <button type="submit" style={{ width: 'fit-content' }}>Change password</button>
        </form>
      </section>

      <section className="account-settings-page__card">
        <h2 style={{ marginTop: 0 }}>Privacy & Data</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={handleDownloadData}>Download personal data (JSON)</button>
          <button onClick={handleDeleteAccount} style={{ background: 'var(--color-error)', color: 'var(--color-text-primary)' }}>Delete account</button>
        </div>
        {profile.deletion_scheduled_for && (
          <p style={{ marginTop: 12, color: 'var(--color-error)' }}>
            Deletion scheduled for: {new Date(profile.deletion_scheduled_for).toLocaleString()}
          </p>
        )}
      </section>
    </main>
  )
}
