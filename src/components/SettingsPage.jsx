import { useState } from 'react'
import { openCookiePreferences } from '../privacy/cookieConsent'
import './SettingsPage.css'

const tabs = [
  { id: 'account', label: 'Account' },
  { id: 'security', label: 'Security' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'billing', label: 'Billing' },
  { id: 'privacy', label: 'Privacy & Data' }
]

function ComingSoonRow({ title, description, action = 'Coming soon' }) {
  return (
    <div className="settings-coming-soon-row" aria-disabled="true">
      <div>
        <div className="settings-coming-soon-heading">{title}</div>
        <div className="settings-coming-soon-copy">{description}</div>
      </div>
      <button type="button" disabled className="settings-coming-soon-action">{action}</button>
    </div>
  )
}

export default function SettingsPage({ onBack }) {
  const [activeTab, setActiveTab] = useState('account')
  const [displayName, setDisplayName] = useState('Gautam')
  const [email, setEmail] = useState('gautam@hireflow.dev')
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState({ type: 'idle', message: '' })

  const handleSaveProfile = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setStatus({ type: 'info', message: 'Saving profile changes…' })

    await new Promise((resolve) => setTimeout(resolve, 700))

    if (!displayName.trim() || !email.trim()) {
      setStatus({ type: 'error', message: 'Name and email are required before saving.' })
      setIsSaving(false)
      return
    }

    setStatus({ type: 'success', message: 'Profile settings saved successfully.' })
    setIsSaving(false)
  }

  return (
    <div className="settings-page">
      <div className="settings-container settings-header">
        <button onClick={onBack} className="settings-back-btn" aria-label="Go back to previous page">
          <span aria-hidden="true">←</span> Back
        </button>
        <h1 className="settings-title">Settings</h1>
      </div>

      <div className="settings-container settings-layout">
        <div className="settings-sidebar" role="tablist" aria-label="Settings sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              id={`settings-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`settings-tab-btn ${activeTab === tab.id ? 'settings-tab-btn--active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'account' && (
            <div role="tabpanel" id="settings-panel-account" aria-labelledby="settings-tab-account">
              <h2 className="settings-tab-title">Account</h2>
              <div className="settings-card">
                <h3 className="settings-card-title">Profile</h3>
                <form onSubmit={handleSaveProfile} className="settings-grid">
                  <label className="settings-field-label" htmlFor="settings-name">Full name</label>
                  <input
                    id="settings-name"
                    className="settings-input"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                  />

                  <label className="settings-field-label" htmlFor="settings-email">Email address</label>
                  <input
                    id="settings-email"
                    className="settings-input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                  />

                  <div className="settings-actions-row">
                    <button type="submit" className="settings-primary-btn" disabled={isSaving} aria-busy={isSaving}>
                      {isSaving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </form>
                {status.type !== 'idle' && (
                  <div
                    className={`settings-inline-feedback settings-inline-feedback--${status.type}`}
                    role={status.type === 'error' ? 'alert' : 'status'}
                    aria-live="polite"
                  >
                    {status.message}
                  </div>
                )}
              </div>
              <div className="settings-card"><h3 className="settings-card-title">Organization Info</h3><div className="settings-grid"><div>Organization: HireFlow</div><ComingSoonRow title="Organization roles" description="Granular role and permission controls will appear here." /></div></div>
            </div>
          )}

          {activeTab === 'security' && (<div role="tabpanel" id="settings-panel-security" aria-labelledby="settings-tab-security"><h2 className="settings-tab-title">Security</h2><div className="settings-card"><h3 className="settings-card-title">Password</h3><button type="button" className="settings-primary-btn">Change password</button></div><div className="settings-card"><h3 className="settings-card-title">Sessions</h3><div className="settings-session">Chrome on Mac • Last active 5 minutes ago</div><button type="button" className="settings-secondary-btn">Sign out other sessions</button></div><div className="settings-card"><h3 className="settings-card-title">Two-Factor Authentication (2FA)</h3><ComingSoonRow title="Authenticator app setup" description="2FA enrollment and recovery codes are not available yet." action="Coming soon" /></div></div>)}

          {activeTab === 'notifications' && (<div role="tabpanel" id="settings-panel-notifications" aria-labelledby="settings-tab-notifications"><h2 className="settings-tab-title">Notifications</h2><div className="settings-card"><h3 className="settings-card-title">Email Preferences</h3><ComingSoonRow title="Digest frequency" description="Set immediate, daily, or weekly emails when notification controls ship." /><div className="settings-spacer-sm" /><ComingSoonRow title="Product announcements" description="Choose feature, release, and tips updates for your inbox." /></div><div className="settings-card"><h3 className="settings-card-title">In-App Preferences</h3><ComingSoonRow title="Desktop alerts" description="Real-time in-app alerts and delivery timing controls are coming soon." /></div></div>)}

          {activeTab === 'billing' && (<div role="tabpanel" id="settings-panel-billing" aria-labelledby="settings-tab-billing"><h2 className="settings-tab-title">Billing</h2><div className="settings-card"><h3 className="settings-card-title">Plan & Subscription</h3><div className="settings-block-spacing">Monthly Plan • $99/month</div><button type="button" className="settings-secondary-btn">Manage subscription</button></div><div className="settings-card"><h3 className="settings-card-title">Payment Methods</h3><div className="settings-block-spacing">Visa ending in 4242</div><ComingSoonRow title="Billing contacts" description="Invoice recipients and billing contact rules will be available soon." /></div></div>)}

          {activeTab === 'privacy' && (<div role="tabpanel" id="settings-panel-privacy" aria-labelledby="settings-tab-privacy"><h2 className="settings-tab-title">Privacy & Data</h2><div className="settings-card"><h3 className="settings-card-title">Cookie Preferences</h3><p className="settings-block-spacing">Manage optional analytics and marketing cookies. Necessary cookies stay enabled for account security and app functionality.</p><button type="button" className="settings-secondary-btn" onClick={openCookiePreferences}>Open cookie preferences</button></div><div className="settings-card"><h3 className="settings-card-title">Export Data</h3><ComingSoonRow title="Account data export" description="Download a copy of your account data when export tooling is ready." /></div><div className="settings-card"><h3 className="settings-card-title">Delete Data</h3><ComingSoonRow title="Account deletion" description="Self-serve permanent account deletion workflow is coming soon." /></div></div>)}
        </div>
      </div>

      {status.type !== 'idle' && (
        <div className={`settings-toast settings-toast--${status.type}`} role="status" aria-live="polite">
          {status.message}
        </div>
      )}
    </div>
  )
}
