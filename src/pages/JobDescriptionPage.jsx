import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import API_BASE from '../config/api'
import JobsTable from '../components/jobs/JobsTable'
import JobModal from '../components/jobs/JobModal'
import '../styles/analyses.css'
import '../styles/job-description.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function JobDescriptionPage({ onRequireAuth }) {
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [activeItem, setActiveItem] = useState(null)
  const [resetToken, setResetToken] = useState(0)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const modalTriggerRef = useRef(null)
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
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(payload.error || 'Unable to load job descriptions')
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

  const handleOpenCreate = useCallback((trigger) => {
    modalTriggerRef.current = trigger || null
    setModalMode('create')
    setActiveItem(null)
    setResetToken((current) => current + 1)
    setIsModalOpen(true)
  }, [])

  const handleOpenEdit = useCallback((item, trigger) => {
    modalTriggerRef.current = trigger || null
    setModalMode('edit')
    setActiveItem(item)
    setResetToken((current) => current + 1)
    setIsModalOpen(true)
  }, [])

  const handleModalSubmit = useCallback(async (nextValues) => {
    if (!token) {
      onRequireAuth?.('Please login to manage job descriptions.')
      return
    }

    setIsSubmitting(true)
    setError('')
    setSuccessMessage('')

    try {
      const isEdit = modalMode === 'edit' && activeItem?.id
      const response = await fetch(
        isEdit ? `${API_BASE}/job-descriptions/${activeItem.id}` : `${API_BASE}/job-descriptions`,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(nextValues),
        },
      )

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `Unable to ${isEdit ? 'update' : 'create'} job description`)

      await fetchItems()
      setIsModalOpen(false)
      setSuccessMessage(isEdit ? 'Job updated successfully.' : 'Job created successfully.')
    } catch (requestError) {
      setError(requestError.message || 'Unable to save job description')
    } finally {
      setIsSubmitting(false)
    }
  }, [activeItem, fetchItems, modalMode, onRequireAuth, token])

  const runJobMutation = useCallback(async ({ item, hardDelete = false }) => {
    const response = await fetch(
      `${API_BASE}/job-descriptions/${item.id}${hardDelete ? '?hardDelete=true' : ''}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    )

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Unable to update job description')
  }, [token])

  const handleArchive = useCallback(async (item) => {
    const confirmed = window.confirm(
      `Archive "${item.title || 'Untitled role'}"? This keeps historical analyses intact.`,
    )
    if (!confirmed) return

    setError('')
    setSuccessMessage('')
    try {
      await runJobMutation({ item })
      await fetchItems()
      setSuccessMessage('Job archived successfully.')
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
    setSuccessMessage('')
    try {
      await runJobMutation({ item, hardDelete: true })
      await fetchItems()
      setSuccessMessage('Job deleted successfully.')
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
          <button type="button" className="job-description-page__create-button" onClick={(event) => handleOpenCreate(event.currentTarget)}>
            Create Job
          </button>
        </header>

        {successMessage ? <p className="analyses-layout__state">{successMessage}</p> : null}
        {isLoading ? <p className="analyses-layout__state analyses-layout__state--loading">Loading jobs…</p> : null}
        {!isLoading && error ? (
          <p className="analyses-layout__state analyses-layout__state--error">
            {error} <button type="button" className="jobs-table__action" onClick={fetchItems}>Retry</button>
          </p>
        ) : null}
        {!isLoading && !error && items.length === 0 ? (
          <p className="analyses-layout__state analyses-layout__state--empty">
            No jobs yet. Create your first job to get started.
          </p>
        ) : null}
        {!isLoading && !error && items.length > 0 ? (
          <JobsTable items={items} onEdit={handleOpenEdit} onArchive={handleArchive} onDelete={handleDelete} />
        ) : null}

        <JobModal
          isOpen={isModalOpen}
          mode={modalMode}
          item={activeItem}
          resetToken={resetToken}
          isSubmitting={isSubmitting}
          onSubmit={handleModalSubmit}
          onClose={() => setIsModalOpen(false)}
          triggerRef={modalTriggerRef}
        />
      </div>
    </section>
  )
}