import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import JobsTable from '../components/jobs/JobsTable'
import JobDescriptionForm from '../components/JobDescriptionForm'
import '../styles/analyses.css'
import '../styles/job-description.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function JobDescriptionPage({ onRequireAuth }) {
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const token = useMemo(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '', [])

  const fetchItems = useCallback(async () => {
    if (!token) {
      setError('Please login to manage job descriptions.')
      onRequireAuth?.('Please login to manage job descriptions.')
      setIsLoading(false)
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

  const handleCreateJob = useCallback(async (nextValues) => {
    if (!token) {
      onRequireAuth?.('Please login to manage job descriptions.')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/job-descriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(nextValues),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create job description')
      }

      setIsCreating(false)
      await fetchItems()
    } catch (requestError) {
      setError(requestError.message || 'Unable to create job description')
    } finally {
      setIsSubmitting(false)
    }
  }, [fetchItems, onRequireAuth, token])

  const runJobMutation = useCallback(async ({ item, hardDelete = false }) => {
    const response = await fetch(`${API_BASE}/job-descriptions/${item.id}${hardDelete ? '?hardDelete=true' : ''}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to update job description')
    }

    if (hardDelete) {
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      return
    }

    setItems((current) => current.map((candidate) => (
      candidate.id === item.id
        ? { ...candidate, status: 'archived', updatedAt: new Date().toISOString() }
        : candidate
    )))
  }, [token])

  const handleArchive = useCallback(async (item) => {
    const confirmed = window.confirm(`Archive "${item.title || 'Untitled role'}"? This keeps historical analyses intact.`)
    if (!confirmed) return

    setError('')
    try {
      await runJobMutation({ item })
      await fetchItems()
    } catch (requestError) {
      setError(requestError.message || 'Unable to archive job description')
    }
  }, [fetchItems, runJobMutation])

  const handleDelete = useCallback(async (item) => {
    const archiveInstead = window.confirm(
      `Archive is recommended for "${item.title || 'Untitled role'}". Press OK to archive, Cancel for permanent delete options.`,
    )

    if (archiveInstead) {
      await handleArchive(item)
      return
    }

    const confirmedHardDelete = window.confirm(
      `Permanently delete "${item.title || 'Untitled role'}"? Linked resumes/analyses may be affected if dependencies exist.`,
    )
    if (!confirmedHardDelete) return

    setError('')
    try {
      await runJobMutation({ item, hardDelete: true })
      await fetchItems()
    } catch (requestError) {
      setError(requestError.message || 'Unable to delete job description')
    }
  }, [fetchItems, handleArchive, runJobMutation])

  return (
    <section className="analyses-layout job-description-page">
      <div className="analyses-layout__content">
        <header className="analyses-page__header">
          <div>
            <h1>Jobs</h1>
            <p>Manage your job descriptions used for resume screening workflows.</p>
          </div>
          <button type="button" className="job-description-page__create-button" onClick={() => setIsCreating(true)}>
            Create Job
          </button>
        </header>

        {isCreating ? (
          <JobDescriptionForm
            onSubmit={handleCreateJob}
            onCancel={() => setIsCreating(false)}
            isSubmitting={isSubmitting}
          />
        ) : null}

        {isLoading ? <p className="analyses-layout__state analyses-layout__state--loading">Loading jobs…</p> : null}
        {!isLoading && error ? <p className="analyses-layout__state analyses-layout__state--error">{error}</p> : null}
        {!isCreating && !isLoading && !error && items.length === 0 ? (
          <p className="analyses-layout__state analyses-layout__state--empty">
            No jobs yet. Create your first job to get started.
          </p>
        ) : null}
        {!isCreating && !isLoading && !error && items.length > 0 ? (
          <JobsTable
            items={items}
            onEdit={() => {}}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        ) : null}
      </div>
    </section>
  )
}
