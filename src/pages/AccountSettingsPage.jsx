import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import { openCookiePreferences } from '../privacy/cookieConsent'
import { resolveSubscriptionState } from '../utils/subscriptionState'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const E164_REGEX = /^\+[1-9]\d{1,14}$/

function Toast({ type, message }) {
  if (!message) return null

  return (
    <div
      className={[
        'account-settings-toast',
        type === 'error' ? 'account-settings-toast--error' : 'account-settings-toast--success',
      ].join(' ')}
      role="status"
      aria-live="polite"
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
  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordHint, setPasswordHint] = useState('')
  const [passwordMismatch, setPasswordMismatch] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [isSigningOutAll, setIsSigningOutAll] = useState(false)
  const [toast, setToast] = useState({ type: 'success', message: '' })
  const [loading, setLoading] = useState(true)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const token = useMemo(() => localStorage.getItem(TOKEN_STORAGE_KEY), [])
  const isProfileDirty = Boolean(profile) && (company !== (profile.company || '') || phone !== (profile.phone || ''))
  const subscriptionState = useMemo(() => resolveSubscriptionState({ user: profile }), [profile])
  const billingPrimaryHref = subscriptionState.isFree ? '/pricing' : '/billing'
  const billingPrimaryLabel = subscriptionState.isFree ? 'View pricing' : 'Open Billing & Plans'

  const pushToast = useCallback((type, message) => {
    setToast({ type, message })
    window.setTimeout(() => setToast({ type: 'success', message: '' }), 2800)
  }, [])

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  const loadProfile = useCallback(async () => {
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
  }, [pushToast, token])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const handleProfileSave = async (event) => {
    event.preventDefault()

    if (!isProfileDirty) {
      return
    }

    if (phone.trim() && !E164_REGEX.test(phone.trim())) {
      pushToast('error', 'Phone must use E.164 format (example: +14155552671).')
      return
    }

    try {
      setIsSavingProfile(true)
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
      setCompany(payload.user.company || '')
      setPhone(payload.user.phone || '')
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(payload.user))
      pushToast('success', 'Profile updated successfully.')
    } catch (error) {
      pushToast('error', error.message)
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handlePasswordChange = async (event) => {
    event.preventDefault()
    setPasswordHint('')
    setPasswordMismatch('')

    if (newPassword !== confirmPassword) {
      setPasswordMismatch('Passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setPasswordHint('New password must be at least 8 characters long.')
      return
    }

    try {
      setIsChangingPassword(true)
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
      pushToast('success', 'Password changed successfully. Use your new password the next time you sign in.')
    } catch (error) {
      pushToast('error', error.message)
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleSignOutAllSessions = async () => {
    const confirmed = window.confirm('Sign out of all devices now? You will be signed out on this device immediately.')
    if (!confirmed) return

    try {
      setIsSigningOutAll(true)
      const response = await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || 'Could not sign out of all sessions.')
      }

      localStorage.removeItem(TOKEN_STORAGE_KEY)
      localStorage.removeItem(USER_STORAGE_KEY)
      pushToast('success', 'Signed out of all sessions. Redirecting to login…')
      window.setTimeout(() => {
        window.location.assign('/login')
      }, 1100)
    } catch (error) {
      pushToast('error', error.message)
    } finally {
      setIsSigningOutAll(false)
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
    if (deleteConfirmText.trim() && deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      pushToast('error', 'Typed confirmation must be DELETE (or leave it blank).')
      return
    }
    try {
      setIsDeleting(true)
      const response = await fetch(`${API_BASE}/profile/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to schedule deletion')
      }

      setProfile((current) => ({ ...current, deleted_at: payload.deleted_at, deletion_scheduled_for: payload.deletion_scheduled_for }))
      setShowDeleteModal(false)
      setDeleteConfirmText('')
      pushToast('success', 'Account deletion scheduled with a 30-day grace period.')
    } catch (error) {
      pushToast('error', error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  if (loading) {
    return <div className="type-body account-settings-state">Loading account settings...</div>
  }

  if (!profile) {
    return <div className="type-body account-settings-state">Unable to load profile.</div>
  }

  return (
    <main className="account-settings-page">
      <Toast type={toast.type} message={toast.message} />

      <h1 className="type-h1 account-settings-title">Account Settings</h1>
      <p className="type-body account-settings-subtitle">Manage your profile and security settings.</p>

      <section className="account-settings-card">
        <h2 className="type-h2 account-settings-card-title">Profile</h2>
        <p className="type-body account-settings-card-helper">Update your company and contact details used across your workspace.</p>
        <form onSubmit={handleProfileSave} className="account-settings-form account-settings-profile-form">
          <label className="account-settings-label">
            <span>Company</span>
            <input
              className="account-settings-input"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              maxLength={100}
            />
          </label>

          <label className="account-settings-label">
            <span>Phone (E.164)</span>
            <input
              className="account-settings-input"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+14155552671"
            />
          </label>

          <label className="account-settings-label account-settings-label--readonly">
            <span>Email</span>
            <input className="account-settings-input account-settings-input--readonly" value={profile.email || ''} disabled />
          </label>

          <label className="account-settings-label account-settings-label--readonly">
            <span>Subscription status</span>
            <input
              className="account-settings-input account-settings-input--readonly"
              value={profile.subscription_status || 'inactive'}
              disabled
            />
          </label>

          <div className="type-small account-settings-note account-settings-note--readonly">
            {subscriptionState.isFree ? (
              <>To start a subscription, visit <a href="/pricing">Pricing</a>.</>
            ) : (
              <>To manage your subscription, visit <a href="/billing">Billing &amp; Plans</a>.</>
            )}
          </div>

          {isProfileDirty && (
            <button type="submit" className="type-button account-settings-button account-settings-button--fit" disabled={isSavingProfile}>
              {isSavingProfile ? 'Saving…' : 'Save profile'}
            </button>
          )}
        </form>

        <div className="type-small account-settings-metadata-row">
          <span className="account-settings-metadata-label">Account created</span>
          <span>{profile.created_at ? new Date(profile.created_at).toLocaleString() : 'Unknown'}</span>
        </div>
      </section>

      <section className="account-settings-card">
        <h2 className="type-h2 account-settings-card-title">Security</h2>
        <p className="type-body account-settings-card-helper">Keep your account secure by rotating your password regularly.</p>
        <form onSubmit={handlePasswordChange} className="account-settings-form">
          <label className="account-settings-label">
            <span>Current password</span>
            <div className="account-settings-password-row">
              <input className="account-settings-input" type={showOldPassword ? 'text' : 'password'} value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required />
              <button type="button" className="account-settings-inline-toggle" onClick={() => setShowOldPassword((current) => !current)}>{showOldPassword ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          <label className="account-settings-label">
            <span>New password</span>
            <div className="account-settings-password-row">
              <input className="account-settings-input" type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} />
              <button type="button" className="account-settings-inline-toggle" onClick={() => setShowNewPassword((current) => !current)}>{showNewPassword ? 'Hide' : 'Show'}</button>
            </div>
            <span className="type-small account-settings-inline-hint">Use at least 8 characters with a mix of upper/lowercase letters, numbers, and a symbol.</span>
            {passwordHint && <span className="type-small account-settings-warning">{passwordHint}</span>}
          </label>
          <label className="account-settings-label">
            <span>Confirm new password</span>
            <div className="account-settings-password-row">
              <input className="account-settings-input" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} />
              <button type="button" className="account-settings-inline-toggle" onClick={() => setShowConfirmPassword((current) => !current)}>{showConfirmPassword ? 'Hide' : 'Show'}</button>
            </div>
            {passwordMismatch && <span className="type-small account-settings-warning">{passwordMismatch}</span>}
          </label>
          <button type="submit" className="type-button account-settings-button account-settings-button--fit" disabled={isChangingPassword}>
            {isChangingPassword ? 'Changing password…' : 'Change password'}
          </button>
        </form>

        <div className="account-settings-actions">
          <button className="type-button account-settings-button account-settings-button--danger" onClick={handleSignOutAllSessions} disabled={isSigningOutAll}>
            {isSigningOutAll ? 'Signing out…' : 'Sign out of all devices'}
          </button>
          <button className="type-button account-settings-button" disabled aria-disabled="true" title="Coming soon">
            Set up 2FA (coming soon)
          </button>
        </div>
        <p className="type-small account-settings-note">Two-factor authentication setup is being rolled out. This control will be enabled soon.</p>
      </section>



      <section className="account-settings-card">
        <h2 className="type-h2 account-settings-card-title">Billing</h2>
        <p className="type-body account-settings-card-helper">Manage plan, invoices, and renewal details from Billing &amp; Plans.</p>
        <div className="account-settings-actions">
          <a className="type-button account-settings-button" href={billingPrimaryHref}>
            {billingPrimaryLabel}
          </a>
        </div>
      </section>

      <section className="account-settings-card">
        <h2 className="type-h2 account-settings-card-title">Privacy & Data</h2>
        <p className="type-body account-settings-card-helper">Control your personal data export and account lifecycle.</p>

        <div className="account-settings-subsection">
          <h3 className="type-h3 account-settings-subsection-title">Data export</h3>
          <p className="type-small account-settings-note">
            Exports are delivered as a JSON file containing your profile and account metadata.
          </p>
          <p className="type-small account-settings-note">
            Delivery starts immediately in your browser after request completion and can take a few seconds for larger accounts.
          </p>
          <div className="account-settings-actions">
            <button className="type-button account-settings-button" onClick={handleDownloadData}>
              Download personal data (JSON)
            </button>
          </div>
        </div>

        <div className="account-settings-subsection">
          <h3 className="type-h3 account-settings-subsection-title">Cookie preferences</h3>
          <p className="type-small account-settings-note">
            Manage optional analytics and marketing cookie choices without changing necessary account and security storage.
          </p>
          <div className="account-settings-actions">
            <button type="button" className="type-button account-settings-button" onClick={openCookiePreferences}>
              Open cookie preferences
            </button>
            <a className="type-button account-settings-button" href="/cookie-policy">Read Cookie Policy</a>
          </div>
        </div>

        <div className="account-settings-subsection account-settings-subsection--danger" role="group" aria-labelledby="danger-zone-title">
          <h3 id="danger-zone-title" className="type-h3 account-settings-subsection-title account-settings-subsection-title--danger">Danger Zone</h3>
          <p className="type-small account-settings-warning">
            This action schedules permanent account deletion after a 30-day grace period and may remove access to workspace history.
          </p>
          <div className="account-settings-actions">
            <button
              className="type-button account-settings-button account-settings-button--destructive-secondary"
              onClick={() => setShowDeleteModal(true)}
            >
              Delete account
            </button>
          </div>
        </div>

        {profile.deletion_scheduled_for && (
          <p className="type-small account-settings-warning">
            Deletion scheduled for: {new Date(profile.deletion_scheduled_for).toLocaleString()}
          </p>
        )}
      </section>

      {showDeleteModal && (
        <div className="account-settings-modal-backdrop" role="presentation">
          <div className="account-settings-modal" role="dialog" aria-modal="true" aria-labelledby="delete-account-modal-title">
            <h3 id="delete-account-modal-title" className="type-h3 account-settings-card-title">Confirm account deletion</h3>
            <p className="type-small account-settings-warning">
              You are scheduling this account for deletion. After the grace period, your login and retained account data will be permanently removed.
            </p>
            <p className="type-small account-settings-note">
              Type <strong>DELETE</strong> to add an extra confirmation step.
            </p>
            <input
              className="account-settings-input"
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
              placeholder="Type DELETE"
            />
            <div className="account-settings-actions">
              <button
                type="button"
                className="type-button account-settings-button"
                onClick={() => {
                  setShowDeleteModal(false)
                  setDeleteConfirmText('')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="type-button account-settings-button account-settings-button--destructive-secondary"
                onClick={handleDeleteAccount}
                disabled={isDeleting}
              >
                {isDeleting ? 'Scheduling deletion…' : 'Confirm deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
