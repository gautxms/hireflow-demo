import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import API_BASE from '../config/api'
import JobsTable from '../components/jobs/JobsTable'
import JobModal from '../components/jobs/JobModal'
import '../styles/analyses.css'
import '../styles/job-description.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function JobDescriptionPage({ onRequireAuth, isReadOnly = false }) {
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [activeItem, setActiveItem] = useState(null)
  const [resetToken, setResetToken] = useState(0)
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')
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
      const response = await fetch(`${API_BASE}/job-descriptions`, {
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
    if (isReadOnly) return
    modalTriggerRef.current = trigger || null
    setModalMode('create')
    setActiveItem(null)
    setResetToken((current) => current + 1)
    setModalError('')
    setIsModalOpen(true)
  }, [isReadOnly])

  const handleOpenEdit = useCallback((item, trigger) => {
    modalTriggerRef.current = trigger || null
    setModalMode(isReadOnly ? 'view' : 'edit')
    setActiveItem(item)
    setResetToken((current) => current + 1)
    setModalError('')
    setIsModalOpen(true)
  }, [isReadOnly])

  const handleModalSubmit = useCallback(async (nextValues) => {
    if (isReadOnly) return
    if (!token) {
      onRequireAuth?.('Please login to manage job descriptions.')
      return
    }

    setIsSubmitting(true)
    setError('')
    setModalError('')
    setSuccessMessage('')

    try {
      const isEdit = modalMode === 'edit' && activeItem?.id
      const isMultipart = nextValues instanceof FormData
      const response = await fetch(
        isEdit ? `${API_BASE}/job-descriptions/${activeItem.id}` : `${API_BASE}/job-descriptions`,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
          },
          body: isMultipart ? nextValues : JSON.stringify(nextValues),
        },
      )

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `Unable to ${isEdit ? 'update' : 'create'} job description`)

      await fetchItems()
      setIsModalOpen(false)
      setSuccessMessage(isEdit ? 'Job updated successfully.' : 'Job created successfully.')
    } catch (requestError) {
      setModalError(requestError.message || 'Unable to save job description')
    } finally {
      setIsSubmitting(false)
    }
  }, [activeItem, fetchItems, isReadOnly, modalMode, onRequireAuth, token])

  const archiveJob = useCallback(async (item) => {
    const response = await fetch(`${API_BASE}/job-descriptions/${item.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Unable to archive job description')
  }, [token])

  const [archivingJobId, setArchivingJobId] = useState('')

  const handleArchive = useCallback(async (item) => {
    if (isReadOnly) return
    const confirmedArchive = window.confirm(
      'Archive this job? It will be hidden from active job lists, but historical analyses and candidate results will remain available.',
    )
    if (!confirmedArchive) return

    setError('')
    setSuccessMessage('')
    try {
      setArchivingJobId(String(item.id))
      await archiveJob(item)
      setItems((currentItems) => currentItems.filter((currentItem) => String(currentItem.id) !== String(item.id)))
      setSuccessMessage('Job archived successfully.')
    } catch (requestError) {
      setError(requestError.message || 'Unable to archive job description')
    } finally {
      setArchivingJobId('')
    }
  }, [archiveJob, isReadOnly])

  return (
    <section className="analyses-layout job-description-page">
      <div className="analyses-layout__content">
        <header className="analyses-page__header">
          <div>
            <h1>Jobs</h1>
            <p>{isReadOnly ? 'View your historical job descriptions and attachments.' : 'Manage your job descriptions used for resume screening workflows.'}</p>
          </div>
          {!isReadOnly ? (
            <button type="button" className="btn-primary" onClick={(event) => handleOpenCreate(event.currentTarget)}>
              Create Job
            </button>
          ) : null}
        </header>

        {successMessage ? <p className="analyses-layout__state">{successMessage}</p> : null}
        {isLoading ? <p className="analyses-layout__state analyses-layout__state--loading">Loading jobs…</p> : null}
        {!isLoading && error ? (
          <p className="analyses-layout__state analyses-layout__state--error">
            {error} <button type="button" className="hf-btn hf-btn--secondary" onClick={fetchItems}>Retry</button>
          </p>
        ) : null}
        {!isLoading && !error && items.length === 0 ? (
          <p className="analyses-layout__state analyses-layout__state--empty">
            {isReadOnly ? 'No historical jobs are available.' : 'No jobs yet. Create your first job to get started.'}
          </p>
        ) : null}
        {!isLoading && !error && items.length > 0 ? (
          <JobsTable items={items} onEdit={handleOpenEdit} onArchive={handleArchive} archivingId={archivingJobId} readOnly={isReadOnly} />
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
          errorMessage={modalError}
          readOnly={isReadOnly}
        />
      </div>
    </section>
  )
}
