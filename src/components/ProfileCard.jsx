import { useEffect, useState } from 'react'
import API_BASE from '../config/api'
import './accountCards.css'

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
    <div className="hf-account-card">
      <h2 className="hf-account-card__title">
        <span className="hf-account-card__icon">👤</span>
        Profile
      </h2>
      {message ? (
        <p className={`hf-account-card__message ${messageType === 'success' ? 'hf-account-card__message--success' : 'hf-account-card__message--error'}`}>
          {message}
        </p>
      ) : null}

      {!editing ? (
        <>
          <div className="hf-account-card__section">
            <p className="hf-account-card__label">Email</p>
            <p className="hf-account-card__value">{user?.email}</p>
          </div>

          <div className="hf-account-card__section">
            <p className="hf-account-card__label">Company</p>
            <p className={`hf-account-card__value ${user?.company ? '' : 'hf-account-card__value--muted'}`}>{user?.company || 'Not set'}</p>
          </div>

          <div className="hf-account-card__section hf-account-card__section--last">
            <p className="hf-account-card__label">Phone</p>
            <p className={`hf-account-card__value ${user?.phone ? '' : 'hf-account-card__value--muted'}`}>{user?.phone || 'Not set'}</p>
          </div>

          <button onClick={() => setEditing(true)} className="hf-account-card__button hf-account-card__button--primary">
            Edit Profile
          </button>
        </>
      ) : (
        <>
          <input
            value={formData.company}
            onChange={(event) => setFormData({ ...formData, company: event.target.value })}
            placeholder="Company name"
            className="hf-account-card__input"
          />
          <input
            value={formData.phone}
            onChange={(event) => setFormData({ ...formData, phone: event.target.value })}
            placeholder="Phone number"
            className="hf-account-card__input hf-account-card__input--last"
          />
          <div className="hf-account-card__button-row">
            <button onClick={handleSave} className="hf-account-card__button hf-account-card__button--primary hf-account-card__button--split">
              Save Changes
            </button>
            <button onClick={() => setEditing(false)} className="hf-account-card__button hf-account-card__button--secondary hf-account-card__button--split">
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
