import { useCallback, useEffect, useMemo, useState } from 'react'
import JobDescriptionForm from '../components/JobDescriptionForm'
import JobDescriptionList from '../components/JobDescriptionList'
import { serializeJobDescriptionForm } from '../components/jobDescriptionFormState'
import { shouldResetAfterSave } from './jobDescriptionSubmissionState'
import API_BASE from '../config/api'
import '../styles/job-description.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const ROUTE_STATES = ['active', 'draft', 'archived']
const getAuthToken = () => localStorage.getItem(TOKEN_STORAGE_KEY) || ''

export default function JobDescriptionPage({ onRequireAuth }) {
  const [items, setItems] = useState([])
  const [activeItem, setActiveItem] = useState(null)
  const [formResetToken, setFormResetToken] = useState(0)
  const [loadState, setLoadState] = useState('idle')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [routeState, setRouteState] = useState('active')
  const [searchText, setSearchText] = useState('')
  const [selectedItemId, setSelectedItemId] = useState('')
  const isLoading = loadState === 'idle' || loadState === 'loading'

  const mapAuthError = (response, payload) => {
    if (response.status === 401) {
      return {
        state: 'auth-required',
        message: payload.error || 'Your session expired. Please sign in again.',
      }
    }
    if (response.status === 402) {
      return {
        state: 'subscription-required',
        message: payload.error || 'An active subscription is required to manage job descriptions.',
      }
    }
    if (response.status === 403) {
      return {
        state: 'subscription-required',
        message: payload.error || 'You do not have access to manage job descriptions on this account.',
      }
    }
    return null
  }

  const fetchItems = useCallback(async () => {
    const token = getAuthToken()
    if (!token) {
      setLoadState('auth-required')
      setError('Please login to manage job descriptions.')
      onRequireAuth?.('Please login to manage job descriptions.')
      return
    }

    setLoadState('loading')
    setError('')

    try {
      const response = await fetch(`${API_BASE}/job-descriptions?includeArchived=true`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const authError = mapAuthError(response, payload)
        if (authError) {
          setLoadState(authError.state)
          setError(authError.message)
          if (authError.state === 'auth-required') {
            onRequireAuth?.(authError.message)
          }
          return
        }
        throw new Error(payload.error || 'Unable to load job descriptions')
      }

      setItems(Array.isArray(payload.items) ? payload.items : [])
      setLoadState('success')
    } catch (requestError) {
      setLoadState('error')
      setError(requestError.message || 'Unable to load job descriptions')
    }
  }, [onRequireAuth])

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
    const token = getAuthToken()
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
    const token = getAuthToken()
    await fetch(`${API_BASE}/job-descriptions/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  const hardDeleteItem = async (item) => {
    const token = getAuthToken()
    await fetch(`${API_BASE}/job-descriptions/${item.id}?hardDelete=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  const duplicateItem = async (item) => {
    const token = getAuthToken()
    await fetch(`${API_BASE}/job-descriptions/${item.id}/duplicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    await fetchItems()
  }

  return (
    <section className="job-description-page">
      <header className="job-description-page__header">
        <h1 className="job-description-page__title">Job Descriptions</h1>
        <p className="job-description-page__subtitle">
          Upload/paste job descriptions, keep drafts, and choose an active JD for resume screening.
        </p>
      </header>

      {error && (
        <div className="job-description-page__error">
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
        <p className="job-description-page__loading">Loading job descriptions...</p>
      ) : loadState === 'auth-required' ? (
        <div className="job-description-page__error">
          <p>{error || 'Please login to manage job descriptions.'}</p>
          <button type="button" onClick={() => fetchItems()}>Retry</button>
        </div>
      ) : loadState === 'subscription-required' ? (
        <div className="job-description-page__error">
          <p>{error || 'An active subscription is required to manage job descriptions.'}</p>
          <button type="button" onClick={() => fetchItems()}>Retry</button>
        </div>
      ) : loadState === 'error' ? (
        <div className="job-description-page__error">
          <p>{error || 'Unable to load job descriptions'}</p>
          <button type="button" onClick={() => fetchItems()}>Retry</button>
        </div>
      ) : (
        <>
          <div className="job-description-page__route-controls">
            {ROUTE_STATES.map((state) => (
              <button
                key={state}
                type="button"
                onClick={() => setRouteState(state)}
                className={`job-description-page__route-button ${routeState === state ? 'job-description-page__route-button--active' : ''}`}
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
            className="job-description-page__search"
          />

          <div className="job-description-page__content">
            <JobDescriptionList
              items={visibleItems}
              onEdit={setActiveItem}
              onDuplicate={duplicateItem}
              onArchive={archiveItem}
              onDelete={hardDeleteItem}
              onSelect={(item) => setSelectedItemId(item.id)}
              selectedItemId={selectedItem?.id || ''}
            />

            <aside className="job-description-page__panel">
              {selectedItem ? (
                <>
                  <h3 className="job-description-page__panel-title">{selectedItem.title}</h3>
                  <p className="job-description-page__panel-description">{selectedItem.description || 'No description available.'}</p>
                  <p className="job-description-page__meta"><strong>Status:</strong> {selectedItem.status || 'draft'}</p>
                  {selectedItem.requirements ? <p className="job-description-page__meta"><strong>Requirements:</strong> {selectedItem.requirements}</p> : null}
                  {selectedItem.location ? <p className="job-description-page__meta"><strong>Location:</strong> {selectedItem.location}</p> : null}
                  {selectedItem.skills?.length ? <p className="job-description-page__meta"><strong>Skills:</strong> {selectedItem.skills.join(', ')}</p> : null}
                  {selectedItem.department ? <p className="job-description-page__meta"><strong>Department:</strong> {selectedItem.department}</p> : null}
                  {selectedItem.employmentType ? <p className="job-description-page__meta"><strong>Employment type:</strong> {selectedItem.employmentType}</p> : null}
                  {selectedItem.priority !== undefined && selectedItem.priority !== null ? <p className="job-description-page__meta"><strong>Priority:</strong> {selectedItem.priority}</p> : null}
                  {selectedItem.archivedReason ? <p className="job-description-page__meta"><strong>Archived reason:</strong> {selectedItem.archivedReason}</p> : null}
                  {selectedItem.sourceType ? <p className="job-description-page__meta"><strong>Source:</strong> {selectedItem.sourceType}</p> : null}
                  {selectedItem.version ? <p className="job-description-page__meta"><strong>Version:</strong> {selectedItem.version}</p> : null}
                </>
              ) : (
                <p className="job-description-page__empty-panel">
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
