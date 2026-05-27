import { useState } from 'react'

const tabs = [
  { id: 'account', label: 'Account' },
  { id: 'security', label: 'Security' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'billing', label: 'Billing' },
  { id: 'privacy', label: 'Privacy & Data' }
]

const cardStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '2rem',
  marginBottom: '1.5rem'
}

const comingSoonRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: '1rem',
  padding: '0.9rem 1rem',
  borderRadius: '8px',
  border: '1px dashed var(--border)',
  background: 'rgba(0,0,0,0.2)',
  opacity: 0.75,
  alignItems: 'center'
}

function ComingSoonRow({ title, description, action = 'Coming soon' }) {
  return (
    <div style={comingSoonRowStyle} aria-disabled="true">
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          {description}
        </div>
      </div>
      <button
        type="button"
        disabled
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--color-text-secondary)',
          padding: '0.45rem 0.8rem',
          borderRadius: '4px',
          fontSize: '0.8rem',
          textTransform: 'uppercase'
        }}
      >
        {action}
      </button>
    </div>
  )
}

export default function SettingsPage({ onBack }) {
  const [activeTab, setActiveTab] = useState('account')

  return (
    <div style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--color-accent-green)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>
          ← Back
        </button>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>Settings</h1>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '250px 1fr', gap: '2rem' }}>
        <div style={{ borderRight: '1px solid var(--border)', paddingRight: '2rem' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: activeTab === tab.id ? 'rgba(232,255,90,0.1)' : 'transparent',
                border: activeTab === tab.id ? '1px solid var(--color-accent-green)' : '1px solid transparent',
                color: activeTab === tab.id ? 'var(--color-accent-green)' : 'var(--color-text-secondary)',
                padding: '0.75rem 1rem',
                borderRadius: '6px',
                marginBottom: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'account' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Account</h2>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Profile</h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <div>Full name: Gautam</div>
                  <div>Email: gautam@hireflow.dev</div>
                </div>
              </div>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Organization Info</h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <div>Organization: HireFlow</div>
                  <ComingSoonRow title="Organization roles" description="Granular role and permission controls will appear here." />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Security</h2>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Password</h3>
                <button style={{ background: 'var(--color-accent-green)', color: 'var(--color-bg-primary)', border: 'none', padding: '0.75rem 1.25rem', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>Change password</button>
              </div>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Sessions</h3>
                <div style={{ marginBottom: '1rem' }}>Chrome on Mac • Last active 5 minutes ago</div>
                <button style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--color-text-secondary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Sign out other sessions</button>
              </div>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Two-Factor Authentication (2FA)</h3>
                <ComingSoonRow title="Authenticator app setup" description="2FA enrollment and recovery codes are not available yet." action="Coming soon" />
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Notifications</h2>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Email Preferences</h3>
                <ComingSoonRow title="Digest frequency" description="Set immediate, daily, or weekly emails when notification controls ship." />
                <div style={{ height: '0.75rem' }} />
                <ComingSoonRow title="Product announcements" description="Choose feature, release, and tips updates for your inbox." />
              </div>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>In-App Preferences</h3>
                <ComingSoonRow title="Desktop alerts" description="Real-time in-app alerts and delivery timing controls are coming soon." />
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Billing</h2>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Plan & Subscription</h3>
                <div style={{ marginBottom: '0.75rem' }}>Pro Plan • $299/month</div>
                <button style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--color-text-secondary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Manage subscription</button>
              </div>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Payment Methods</h3>
                <div style={{ marginBottom: '0.75rem' }}>Visa ending in 4242</div>
                <ComingSoonRow title="Billing contacts" description="Invoice recipients and billing contact rules will be available soon." />
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Privacy & Data</h2>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Export Data</h3>
                <ComingSoonRow title="Account data export" description="Download a copy of your account data when export tooling is ready." />
              </div>
              <div style={cardStyle}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Delete Data</h3>
                <ComingSoonRow title="Account deletion" description="Self-serve permanent account deletion workflow is coming soon." />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
