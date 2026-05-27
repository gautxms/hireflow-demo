import { useState } from 'react'
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

  return (
    <div className="settings-page">
      <div className="settings-container settings-header">
        <button onClick={onBack} className="settings-back-btn">← Back</button>
        <h1 className="settings-title">Settings</h1>
      </div>

      <div className="settings-container settings-layout">
        <div className="settings-sidebar">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`settings-tab-btn ${activeTab === tab.id ? 'settings-tab-btn--active' : ''}`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'account' && (<div><h2 className="settings-tab-title">Account</h2><div className="settings-card"><h3 className="settings-card-title">Profile</h3><div className="settings-grid"><div>Full name: Gautam</div><div>Email: gautam@hireflow.dev</div></div></div><div className="settings-card"><h3 className="settings-card-title">Organization Info</h3><div className="settings-grid"><div>Organization: HireFlow</div><ComingSoonRow title="Organization roles" description="Granular role and permission controls will appear here." /></div></div></div>)}

          {activeTab === 'security' && (<div><h2 className="settings-tab-title">Security</h2><div className="settings-card"><h3 className="settings-card-title">Password</h3><button className="settings-primary-btn">Change password</button></div><div className="settings-card"><h3 className="settings-card-title">Sessions</h3><div className="settings-session">Chrome on Mac • Last active 5 minutes ago</div><button className="settings-secondary-btn">Sign out other sessions</button></div><div className="settings-card"><h3 className="settings-card-title">Two-Factor Authentication (2FA)</h3><ComingSoonRow title="Authenticator app setup" description="2FA enrollment and recovery codes are not available yet." action="Coming soon" /></div></div>)}

          {activeTab === 'notifications' && (<div><h2 className="settings-tab-title">Notifications</h2><div className="settings-card"><h3 className="settings-card-title">Email Preferences</h3><ComingSoonRow title="Digest frequency" description="Set immediate, daily, or weekly emails when notification controls ship." /><div className="settings-spacer-sm" /><ComingSoonRow title="Product announcements" description="Choose feature, release, and tips updates for your inbox." /></div><div className="settings-card"><h3 className="settings-card-title">In-App Preferences</h3><ComingSoonRow title="Desktop alerts" description="Real-time in-app alerts and delivery timing controls are coming soon." /></div></div>)}

          {activeTab === 'billing' && (<div><h2 className="settings-tab-title">Billing</h2><div className="settings-card"><h3 className="settings-card-title">Plan & Subscription</h3><div className="settings-block-spacing">Pro Plan • $299/month</div><button className="settings-secondary-btn">Manage subscription</button></div><div className="settings-card"><h3 className="settings-card-title">Payment Methods</h3><div className="settings-block-spacing">Visa ending in 4242</div><ComingSoonRow title="Billing contacts" description="Invoice recipients and billing contact rules will be available soon." /></div></div>)}

          {activeTab === 'privacy' && (<div><h2 className="settings-tab-title">Privacy & Data</h2><div className="settings-card"><h3 className="settings-card-title">Export Data</h3><ComingSoonRow title="Account data export" description="Download a copy of your account data when export tooling is ready." /></div><div className="settings-card"><h3 className="settings-card-title">Delete Data</h3><ComingSoonRow title="Account deletion" description="Self-serve permanent account deletion workflow is coming soon." /></div></div>)}
        </div>
      </div>
    </div>
  )
}
