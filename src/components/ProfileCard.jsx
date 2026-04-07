import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export default function ProfileCard({ user, token, onRefresh }) {
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    email: user?.email || '',
    company: user?.company || '',
    phone: user?.phone || '',
  })

  useEffect(() => {
    setFormData({
      email: user?.email || '',
      company: user?.company || '',
      phone: user?.phone || '',
    })
  }, [user])

  const handleSave = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          company: formData.company,
          phone: formData.phone,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save profile')
      }

      setEditing(false)
      onRefresh()
    } catch {
      console.error('Failed to save profile')
    }
  }

  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
      }}
    >
      <h2 style={{ marginBottom: '15px', fontSize: '18px', fontWeight: '600' }}>Profile</h2>

      {!editing ? (
        <>
          <p><strong>Email:</strong> {user?.email}</p>
          <p><strong>Company:</strong> {user?.company || 'Not set'}</p>
          <p><strong>Phone:</strong> {user?.phone || 'Not set'}</p>
          <button
            onClick={() => setEditing(true)}
            style={{
              marginTop: '15px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
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
            placeholder="Company"
            style={{ display: 'block', width: '100%', marginBottom: '10px', padding: '8px' }}
          />
          <input
            value={formData.phone}
            onChange={(event) => setFormData({ ...formData, phone: event.target.value })}
            placeholder="Phone"
            style={{ display: 'block', width: '100%', marginBottom: '10px', padding: '8px' }}
          />
          <button
            onClick={handleSave}
            style={{
              marginRight: '10px',
              padding: '8px 16px',
              background: '#22c55e',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '4px',
            }}
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            style={{
              padding: '8px 16px',
              background: '#9ca3af',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '4px',
            }}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  )
}
