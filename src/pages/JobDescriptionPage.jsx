import { useCallback, useEffect, useMemo, useState } from 'react'
import JobDescriptionForm from '../components/JobDescriptionForm'
import JobDescriptionList from '../components/JobDescriptionList'
import { serializeJobDescriptionForm } from '../components/jobDescriptionFormState'
import { shouldResetAfterSave } from './jobDescriptionSubmissionState'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function JobDescriptionPage({ onRequireAuth }) {
  const [items, setItems] = useState([])
  const [activeItem, setActiveItem] = useState(null)
  const [formResetToken, setFormResetToken] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const token = useMemo(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '', [])

  const fetchItems = useCallback(async () => {
    if (!token) {
      onRequireAuth?.('Please login to manage job descriptions.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/job-descriptions?includeArchived=true`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load job descriptions')
      }

      setItems(Array.isArray(payload.items) ? payload.items : [])
    } catch (requestError) {
      setError(requestError.message || 'Unable to load job descriptions')
    } finally {
      setIsLoading(false)
    }
  }, [onRequireAuth, token])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const submitForm = async (formValues) => {
    if (!token) {
      onRequireAuth?.('Please login to manage job descriptions.')
      return
    }

    setIsSubmitting(true)
    setError('')

    const formData = new FormData()
    const payloadValues = serializeJobDescriptionForm(formValues)

    Object.entries(payloadValues).forEach(([key, value]) => {
      if (key === 'jdFile' && value instanceof File) {
        formData.append('jdFile', value)
        return
      }

      if (value !== '' && value !== null && value !== undefined) {
        formData.append(key, value)
      }
    })

    const isEditing = Boolean(activeItem)
    const endpoint = isEditing
      ? `${API_BASE_URL}/api/job-descriptions/${activeItem.id}`
      : `${API_BASE_URL}/api/job-descriptions`

    try {
      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok || !payload.item) {
        throw new Error(payload.error || 'Unable to save job description')
      }

      await fetchItems()
      setActiveItem(null)
      if (shouldResetAfterSave({ isEditing, payload })) {
        setFormResetToken((prev) => prev + 1)
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to save job description')
    } finally {
      setIsSubmitting(false)
    }
  }

  const archiveItem = async (item) => {
    await fetch(`${API_BASE_URL}/api/job-descriptions/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  const hardDeleteItem = async (item) => {
    await fetch(`${API_BASE_URL}/api/job-descriptions/${item.id}?hardDelete=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  const duplicateItem = async (item) => {
    await fetch(`${API_BASE_URL}/api/job-descriptions/${item.id}/duplicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  return (
    <section style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: '0.35rem' }}>Job Descriptions</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Upload/paste job descriptions, keep drafts, and choose an active JD for resume screening.
        </p>
      </header>

      {error && (
        <div style={{ marginBottom: '1rem', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, padding: '0.8rem' }}>
          {error}
        </div>
      )}

      <JobDescriptionForm
        initialValue={activeItem}
        resetToken={formResetToken}
        onSubmit={submitForm}
        onCancel={() => setActiveItem(null)}
        isSubmitting={isSubmitting}
      />

      {isLoading ? (
        <p style={{ color: 'var(--muted)' }}>Loading job descriptions...</p>
      ) : (
        <JobDescriptionList
          items={items}
          onEdit={setActiveItem}
          onDuplicate={duplicateItem}
          onArchive={archiveItem}
          onDelete={hardDeleteItem}
        />
      )}
    </section>
  )
}
