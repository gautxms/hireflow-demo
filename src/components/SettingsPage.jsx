import { useState } from 'react'

export default function SettingsPage({ onBack }) {
  const [activeTab, setActiveTab] = useState('account')
  const [saved, setSaved] = useState(false)

  const tabs = ['account', 'team', 'integrations', 'billing', 'security']

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      {/* Header */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem' }}>
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--accent)',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.9rem'
          }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>
          Settings
        </h1>
      </div>

      {/* Layout */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '250px 1fr', gap: '2rem' }}>
        {/* Sidebar */}
        <div style={{ borderRight: '1px solid var(--border)', paddingRight: '2rem' }}>
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: activeTab === tab ? 'rgba(232,255,90,0.1)' : 'transparent',
                border: activeTab === tab ? '1px solid var(--accent)' : '1px solid transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--muted)',
                padding: '0.75rem 1rem',
                borderRadius: '6px',
                marginBottom: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textTransform: 'capitalize'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div>
          {/* Account Tab */}
          {activeTab === 'account' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem' }}>Account Settings</h2>

              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', marginBottom: '2rem' }}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1.5rem' }}>Profile Information</h3>
                <div style={{ display: 'grid', gap: '1.5rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                      Full Name
                    </label>
                    <input
                      type="text"
                      defaultValue="Gautam"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        color: 'var(--text)',
                        fontFamily: 'var(--font-body)'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                      Email
                    </label>
                    <input
                      type="email"
                      defaultValue="gautam@hireflow.dev"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        color: 'var(--text)',
                        fontFamily: 'var(--font-body)'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                      Company
                    </label>
                    <input
                      type="text"
                      defaultValue="HireFlow"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        color: 'var(--text)',
                        fontFamily: 'var(--font-body)'
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', marginBottom: '2rem' }}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1.5rem' }}>Preferences</h3>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked style={{ cursor: 'pointer' }} />
                    <span>Receive email notifications about new candidates</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked style={{ cursor: 'pointer' }} />
                    <span>Weekly performance report</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                    <input type="checkbox" style={{ cursor: 'pointer' }} />
                    <span>Product updates and feature announcements</span>
                  </label>
                </div>
              </div>

              <button
                onClick={handleSave}
                style={{
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  border: 'none',
                  padding: '0.75rem 2rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                {saved ? '✓ Saved' : 'Save Changes'}
              </button>
            </div>
          )}

          {/* Team Tab */}
          {activeTab === 'team' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem' }}>Team</h2>
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem' }}>
                <p style={{ color: 'var(--muted)', lineHeight: '1.7' }}>
                  Team management is not available in the MVP beta yet. Use one shared account for now and contact support if you need multi-user access.
                </p>
              </div>
            </div>
          )}

          {/* Integrations Tab */}
          {activeTab === 'integrations' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem' }}>Connected Apps</h2>

              {[
                { name: 'Slack', status: 'Connected', color: 'var(--accent-2)' },
                { name: 'Gmail', status: 'Connected', color: 'var(--accent-2)' },
                { name: 'Microsoft Teams', status: 'Not Connected', color: 'var(--muted)' },
                { name: 'Greenhouse', status: 'Not Connected', color: 'var(--muted)' }
              ].map((app, i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '2rem',
                    marginBottom: '1rem',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <h3 style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{app.name}</h3>
                    <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                      {app.status === 'Connected' ? 'Integration is active' : 'Not yet connected'}
                    </p>
                  </div>
                  <button style={{
                    background: app.status === 'Connected' ? 'transparent' : 'var(--accent)',
                    color: app.status === 'Connected' ? app.color : 'var(--ink)',
                    border: app.status === 'Connected' ? `1px solid ${app.color}` : 'none',
                    padding: '0.6rem 1.5rem',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}>
                    {app.status === 'Connected' ? 'Disconnect' : 'Connect'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Billing Tab */}
          {activeTab === 'billing' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem' }}>Billing</h2>

              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', marginBottom: '2rem' }}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1.5rem' }}>Current Plan</h3>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto' }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>Pro Plan</div>
                      <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>$299/month</div>
                    </div>
                    <button style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--muted)',
                      padding: '0.5rem 1.5rem',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}>
                      Change Plan
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem' }}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Payment Method</h3>
                <p style={{ color: 'var(--muted)' }}>
                  Payment processing is not integrated in the MVP beta. Billing setup will be enabled before general availability.
                </p>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem' }}>Security</h2>

              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', marginBottom: '2rem' }}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1.5rem' }}>Password</h3>
                <button style={{
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  border: 'none',
                  padding: '0.75rem 2rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}>
                  Change Password
                </button>
              </div>

              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', marginBottom: '2rem' }}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1.5rem' }}>Two-Factor Authentication</h3>
                <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
                  Protect your account with two-factor authentication
                </p>
                <button style={{
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  border: 'none',
                  padding: '0.75rem 2rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}>
                  Enable 2FA
                </button>
              </div>

              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem' }}>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1.5rem' }}>Active Sessions</h3>
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 'bold' }}>Chrome on Mac</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Last active 5 minutes ago</div>
                  </div>
                  <button style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    padding: '0.5rem 1.5rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}>
                    Sign Out Other Sessions
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
