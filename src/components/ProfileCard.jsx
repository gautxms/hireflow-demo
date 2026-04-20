import { useEffect, useState } from 'react'
import API_BASE from '../config/api'

export default function ProfileCard({ user, token, onRefresh }) {
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('success')
  const [formData, setFormData] = useState({
    company: user?.company || '',
    phone: user?.phone || '',
  })

  useEffect(() => {
    setFormData({
      company: user?.company || '',
      phone: user?.phone || '',
    })
  }, [user])

  const handleSave = async () => {
    try {
      const response = await fetch(`${API_BASE}/profile/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          company: formData.company,
          phone: formData.phone,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save profile')
      }

      setEditing(false)
      setMessageType('success')
      setMessage('Changes saved')
      onRefresh?.()
    } catch (error) {
      setMessageType('error')
      setMessage(error.message || 'Failed to save profile')
      console.error('Failed to save profile', error)
    }
  }

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '28px',
      }}
    >
      <h2
        style={{
          fontSize: '18px',
          fontWeight: '600',
          color: 'var(--color-text-primary)',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '20px' }}>👤</span>
        Profile
      </h2>
      {message ? (
        <p style={{ color: messageType === 'success' ? 'var(--color-success-text)' : 'var(--color-error)', fontSize: '13px', marginBottom: '14px' }}>
          {message}
        </p>
      ) : null}

      {!editing ? (
        <>
          <div style={{ marginBottom: '16px' }}>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Email
            </p>
            <p style={{ color: 'var(--color-text-primary)', fontSize: '14px' }}>{user?.email}</p>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Company
            </p>
            <p style={{ color: user?.company ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontSize: '14px' }}>{user?.company || 'Not set'}</p>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Phone
            </p>
            <p style={{ color: user?.phone ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontSize: '14px' }}>{user?.phone || 'Not set'}</p>
          </div>

          <button
            onClick={() => setEditing(true)}
            style={{
              background: 'var(--color-accent-green)',
              color: 'var(--color-bg-primary)',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 20px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '14px',
              transition: 'opacity var(--motion-duration-base) var(--motion-ease-standard)',
            }}
            onMouseEnter={(event) => {
              event.target.style.opacity = '0.9'
            }}
            onMouseLeave={(event) => {
              event.target.style.opacity = '1'
            }}
          >
            Edit Profile
          </button>
        </>
      ) : (
        <>
          <input
            value={formData.company}
            onChange={(event) => setFormData({ ...formData, company: event.target.value })}
            placeholder="Company name"
            style={{
              display: 'block',
              width: '100%',
              marginBottom: '12px',
              padding: '10px 12px',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--color-text-primary)',
              fontSize: '14px',
            }}
          />
          <input
            value={formData.phone}
            onChange={(event) => setFormData({ ...formData, phone: event.target.value })}
            placeholder="Phone number"
            style={{
              display: 'block',
              width: '100%',
              marginBottom: '16px',
              padding: '10px 12px',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--color-text-primary)',
              fontSize: '14px',
            }}
          />
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleSave}
              style={{
                flex: 1,
                padding: '10px 20px',
                background: 'var(--color-accent-green)',
                color: 'var(--color-bg-primary)',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '14px',
              }}
            >
              Save Changes
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{
                flex: 1,
                padding: '10px 20px',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-primary)',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
