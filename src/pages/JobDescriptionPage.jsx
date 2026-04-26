import { useCallback, useEffect, useMemo, useState } from 'react'
import JobDescriptionForm from '../components/JobDescriptionForm'
import JobDescriptionList from '../components/JobDescriptionList'
import { serializeJobDescriptionForm } from '../components/jobDescriptionFormState'
import { shouldResetAfterSave } from './jobDescriptionSubmissionState'
import API_BASE from '../config/api'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const ROUTE_STATES = ['active', 'draft', 'archived']

export default function JobDescriptionPage({ onRequireAuth }) {
  const [items, setItems] = useState([])
  const [activeItem, setActiveItem] = useState(null)
  const [formResetToken, setFormResetToken] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [routeState, setRouteState] = useState('active')
  const [searchText, setSearchText] = useState('')
  const [selectedItemId, setSelectedItemId] = useState('')
  const token = useMemo(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '', [])

  const fetchItems = useCallback(async () => {
    if (!token) {
      onRequireAuth?.('Please login to manage job descriptions.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/job-descriptions?includeArchived=true`, {
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

  useEffect(() => {
    if (!selectedItemId) {
      return
    }

    const stillExists = items.some((item) => item.id === selectedItemId)
    if (!stillExists) {
      setSelectedItemId('')
    }
  }, [items, selectedItemId])

  const visibleItems = useMemo(() => {
    const query = searchText.trim().toLowerCase()

    return items.filter((item) => {
      if (routeState && item.status !== routeState) {
        return false
      }

      if (!query) {
        return true
      }

      const searchBlob = [
        item.title,
        item.description,
        item.requirements,
        item.location,
        item.department,
        Array.isArray(item.skills) ? item.skills.join(' ') : '',
      ].join(' ').toLowerCase()

      return searchBlob.includes(query)
    })
  }, [items, routeState, searchText])

  const selectedItem = useMemo(() => {
    if (!selectedItemId) {
      return visibleItems[0] || null
    }

    return visibleItems.find((item) => item.id === selectedItemId) || null
  }, [selectedItemId, visibleItems])

  const routeCounts = useMemo(() => ROUTE_STATES.reduce((acc, state) => {
    acc[state] = items.filter((item) => item.status === state).length
    return acc
  }, {}), [items])

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
      ? `${API_BASE}/job-descriptions/${activeItem.id}`
      : `${API_BASE}/job-descriptions`

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
    await fetch(`${API_BASE}/job-descriptions/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  const hardDeleteItem = async (item) => {
    await fetch(`${API_BASE}/job-descriptions/${item.id}?hardDelete=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  const duplicateItem = async (item) => {
    await fetch(`${API_BASE}/job-descriptions/${item.id}/duplicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  return (
    <section style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: '0.35rem' }}>Job Descriptions</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Upload/paste job descriptions, keep drafts, and choose an active JD for resume screening.
        </p>
      </header>

      {error && (
        <div
          style={{
            marginBottom: '1rem',
            border: '1px solid var(--color-error)',
            color: 'var(--color-error)',
            borderRadius: 8,
            padding: '0.8rem',
          }}
        >
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
        <p style={{ color: 'var(--color-text-muted)' }}>Loading job descriptions...</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {ROUTE_STATES.map((state) => (
              <button
                key={state}
                type="button"
                onClick={() => setRouteState(state)}
                style={{
                  ...secondaryButton,
                  borderColor: routeState === state ? 'var(--color-accent-green)' : 'var(--border)',
                  color: routeState === state ? 'var(--color-accent-green)' : '#fff',
                }}
              >
                {capitalize(state)} ({routeCounts[state] || 0})
              </button>
            ))}
          </div>

          <input
            type="search"
            placeholder="Search title, description, skills, location..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            style={{ ...inputStyle, marginBottom: '1rem' }}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)', gap: '1rem' }}>
            <JobDescriptionList
              items={visibleItems}
              onEdit={setActiveItem}
              onDuplicate={duplicateItem}
              onArchive={archiveItem}
              onDelete={hardDeleteItem}
              onSelect={(item) => setSelectedItemId(item.id)}
              selectedItemId={selectedItem?.id || ''}
            />

            <aside style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', alignSelf: 'start', position: 'sticky', top: '1rem' }}>
              {selectedItem ? (
                <>
                  <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>{selectedItem.title}</h3>
                  <p style={{ marginTop: 0, color: 'var(--color-text-secondary)' }}>{selectedItem.description || 'No description available.'}</p>
                  <p style={metaStyle}><strong>Status:</strong> {selectedItem.status || 'draft'}</p>
                  {selectedItem.requirements ? <p style={metaStyle}><strong>Requirements:</strong> {selectedItem.requirements}</p> : null}
                  {selectedItem.location ? <p style={metaStyle}><strong>Location:</strong> {selectedItem.location}</p> : null}
                  {selectedItem.skills?.length ? <p style={metaStyle}><strong>Skills:</strong> {selectedItem.skills.join(', ')}</p> : null}
                  {selectedItem.department ? <p style={metaStyle}><strong>Department:</strong> {selectedItem.department}</p> : null}
                  {selectedItem.employmentType ? <p style={metaStyle}><strong>Employment type:</strong> {selectedItem.employmentType}</p> : null}
                  {selectedItem.priority !== undefined && selectedItem.priority !== null ? <p style={metaStyle}><strong>Priority:</strong> {selectedItem.priority}</p> : null}
                  {selectedItem.archivedReason ? <p style={metaStyle}><strong>Archived reason:</strong> {selectedItem.archivedReason}</p> : null}
                  {selectedItem.sourceType ? <p style={metaStyle}><strong>Source:</strong> {selectedItem.sourceType}</p> : null}
                  {selectedItem.version ? <p style={metaStyle}><strong>Version:</strong> {selectedItem.version}</p> : null}
                </>
              ) : (
                <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
                  No job descriptions match the current route state and filters.
                </p>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  )
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const secondaryButton = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: '#fff',
  borderRadius: 8,
  padding: '0.45rem 0.7rem',
  cursor: 'pointer',
}

const inputStyle = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: '#111827',
  color: '#fff',
  padding: '0.65rem 0.8rem',
}

const metaStyle = {
  marginTop: '0.55rem',
  marginBottom: 0,
  color: 'var(--color-text-secondary)',
}
