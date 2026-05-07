import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, Upload, X } from 'lucide-react'
import API_BASE from '../config/api'
import { ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL, toOptionalJobDescriptionId } from '../components/resumeUploaderState'
import { ANALYSES_PAGE_SIZE, clampAnalysesPage, paginateAnalyses } from './analysesPaginationState'
import '../styles/analyses.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_FILE_COUNT = 20
const CHUNK_SIZE = 5 * 1024 * 1024
const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const DOCX_EXTENSION_PATTERN = /\.docx$/i
const PDF_EXTENSION_PATTERN = /\.pdf$/i

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function normalizeStatus(status) {
  const normalizedStatus = String(status || 'pending').trim().toLowerCase()
  const STATUS_ALIAS_MAP = {
    queued: 'pending',
    retrying: 'processing',
  }
  return STATUS_ALIAS_MAP[normalizedStatus] || normalizedStatus
}


function getFileKey(file) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

function deriveDisplayStatus(analysis) {
  const summary = analysis?.summary || {}
  const total = Number(summary.total || 0)
  const complete = Number(summary.complete || 0)
  const failed = Number(summary.failed || 0)
  const processing = Number(summary.processing || 0)
  const pending = Number(summary.pending || 0)

  if (processing > 0) return 'processing'
  if (pending > 0 && complete < total) return 'pending'
  if (total > 0 && complete === total && failed === 0) return 'complete'
  if (total > 0 && failed === total) return 'failed'
  if (total > 0 && complete > 0 && failed > 0 && pending === 0 && processing === 0) return 'partial'

  return normalizeStatus(analysis?.liveStatus || analysis?.status)
}

function inferResumeMimeType(fileLike = {}) {
  const explicitType = String(fileLike?.type || '').trim().toLowerCase()
  if (ACCEPTED_TYPES.has(explicitType)) return explicitType
  const fileName = String(fileLike?.name || '').trim()
  if (DOCX_EXTENSION_PATTERN.test(fileName)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (PDF_EXTENSION_PATTERN.test(fileName)) return 'application/pdf'
  return explicitType
}

export default function AnalysesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [jobDescriptions, setJobDescriptions] = useState([])
  const [analysisName, setAnalysisName] = useState('')
  const [selectedJobDescriptionId, setSelectedJobDescriptionId] = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [submitError, setSubmitError] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDraggingOverDropzone, setIsDraggingOverDropzone] = useState(false)
  const createButtonRef = useRef(null)
  const nameInputRef = useRef(null)
  const [openSummaryPopoverId, setOpenSummaryPopoverId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [deletingAnalysisId, setDeletingAnalysisId] = useState('')
  const [deleteFeedback, setDeleteFeedback] = useState({ type: '', message: '' })

  const loadAnalyses = async ({ signal } = {}) => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) throw new Error('Authentication required.')
    const response = await fetch(`${API_BASE}/analyses`, { headers: { Authorization: `Bearer ${token}` }, signal })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Unable to load analyses')
    return Array.isArray(payload.items) ? payload.items : []
  }

  useEffect(() => {
    const controller = new AbortController()
    const run = async () => {
      try {
        setLoading(true)
        setError('')
        const nextItems = await loadAnalyses({ signal: controller.signal })
        setItems(nextItems)
      } catch (loadError) {
        if (loadError.name !== 'AbortError') setError(loadError.message || 'Unable to load analyses')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    run()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const hasActiveAnalyses = items.some((analysis) => {
      const status = deriveDisplayStatus(analysis)
      return status === 'pending' || status === 'processing'
    })
    if (!hasActiveAnalyses) return undefined

    const intervalId = window.setInterval(async () => {
      try {
        const nextItems = await loadAnalyses()
        setItems(nextItems)
      } catch {
        // keep existing data if polling request fails
      }
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [items])

  useEffect(() => {
    if (!isCreateModalOpen) return
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) return
    fetch(`${API_BASE}/job-descriptions`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then(({ ok, payload }) => {
        if (!ok) return
        const availableItems = Array.isArray(payload.items) ? payload.items : []
        const eligible = availableItems.filter((item) => item.status === 'active' || item.status === 'draft')
        setJobDescriptions(eligible)
      })
      .catch(() => setJobDescriptions([]))
  }, [isCreateModalOpen])

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [items],
  )
  const { rows: pagedItems, pagination } = useMemo(
    () => paginateAnalyses(sortedItems, currentPage, ANALYSES_PAGE_SIZE),
    [currentPage, sortedItems],
  )
  const totalPages = pagination.totalPages
  const shouldRenderPaginationControls = pagination.shouldRenderControls

  useEffect(() => {
    const nextPage = clampAnalysesPage(currentPage, sortedItems.length, ANALYSES_PAGE_SIZE)
    if (nextPage === currentPage) return
    setCurrentPage(nextPage)
  }, [currentPage, sortedItems.length])

  useEffect(() => {
    if (!openSummaryPopoverId) return undefined
    const handleKeydown = (event) => {
      if (event.key === 'Escape') setOpenSummaryPopoverId(null)
    }
    const handlePointerDown = (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-summary-popover-root="true"]')) return
      setOpenSummaryPopoverId(null)
    }
    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [openSummaryPopoverId])

  const resetModal = () => {
    setIsCreateModalOpen(false)
    setAnalysisName('')
    setSelectedJobDescriptionId('')
    setSelectedFiles([])
    setSubmitError('')
    setValidationErrors({})
    setIsSubmitting(false)
  }

  useEffect(() => {
    if (isCreateModalOpen) return undefined
    createButtonRef.current?.focus()
    return undefined
  }, [isCreateModalOpen])

  const handleFilesSelected = (incomingFiles) => {
    const incomingArray = Array.from(incomingFiles || [])
    const rejected = []
    const validIncoming = []

    incomingArray.forEach((file) => {
      const isAllowedType = ACCEPTED_TYPES.has(inferResumeMimeType(file))
      const isAllowedSize = file.size <= MAX_FILE_SIZE
      if (!isAllowedType) {
        rejected.push(`${file.name}: only PDF or DOCX files are allowed.`)
        return
      }
      if (!isAllowedSize) {
        rejected.push(`${file.name}: exceeds 100MB limit.`)
        return
      }
      validIncoming.push(file)
    })

    setSelectedFiles((currentFiles) => {
      const nextByKey = new Map(currentFiles.map((file) => [getFileKey(file), file]))
      validIncoming.forEach((file) => nextByKey.set(getFileKey(file), file))
      const merged = Array.from(nextByKey.values())
      if (merged.length > MAX_FILE_COUNT) {
        rejected.push(`Maximum ${MAX_FILE_COUNT} files per analysis.`)
      }
      return merged.slice(0, MAX_FILE_COUNT)
    })

    setValidationErrors((current) => ({ ...current, files: rejected.length > 0 ? rejected.join(' ') : '' }))
    setSubmitError('')
  }

  const handleFileSelection = (event) => {
    handleFilesSelected(event.target.files || [])
    event.target.value = ''
  }

  const handleRemoveSelectedFile = (fileKey) => {
    setSelectedFiles((currentFiles) => currentFiles.filter((file) => getFileKey(file) !== fileKey))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const nameValue = analysisName.trim()
    const nextValidationErrors = {
      name: nameValue ? '' : 'Give this analysis a name so you can find it later.',
      files: selectedFiles.length > 0 ? '' : 'Add at least one resume file to continue.',
    }
    setValidationErrors(nextValidationErrors)
    if (nextValidationErrors.name || nextValidationErrors.files) return

    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) {
      setSubmitError('Authentication required.')
      return
    }

    setIsSubmitting(true)
    setSubmitError('')

    try {
      let analysisId = ''
      for (const file of selectedFiles) {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
        const initResponse = await fetch(`${API_BASE}/uploads/chunks/init`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            fileSize: file.size,
            mimeType: inferResumeMimeType(file),
            ...(toOptionalJobDescriptionId(selectedJobDescriptionId) ? { jobDescriptionId: selectedJobDescriptionId } : {}),
            ...(analysisId ? { analysisId } : {}),
            ...(analysisName.trim() ? { analysisName: analysisName.trim() } : {}),
          }),
        })
        const initPayload = await initResponse.json().catch(() => ({}))
        if (!initResponse.ok) throw new Error(initPayload.error || `Failed to start chunk upload for ${file.name}`)
        analysisId = analysisId || String(initPayload.analysisId || '').trim()
        const uploadId = initPayload.uploadId

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          const start = chunkIndex * CHUNK_SIZE
          const end = Math.min(start + CHUNK_SIZE, file.size)
          const chunk = file.slice(start, end)
          const formData = new FormData()
          formData.append('chunk', chunk)
          formData.append('chunkIndex', String(chunkIndex))
          formData.append('totalChunks', String(totalChunks))
          const chunkResponse = await fetch(`${API_BASE}/uploads/chunks/${uploadId}/chunk`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          })
          if (!chunkResponse.ok) {
            const chunkPayload = await chunkResponse.json().catch(() => ({}))
            throw new Error(chunkPayload.error || `Failed to upload chunk for ${file.name}`)
          }
        }

        const completeResponse = await fetch(`${API_BASE}/uploads/chunks/${uploadId}/complete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const completePayload = await completeResponse.json().catch(() => ({}))
        if (!completeResponse.ok) throw new Error(completePayload.error || `Failed to finalize upload for ${file.name}`)
        analysisId = analysisId || String(completePayload.analysisId || '').trim()
      }

      const nextItems = await loadAnalyses()
      setItems(nextItems)
      resetModal()
    } catch (submitFailure) {
      setSubmitError(submitFailure.message || 'Unable to analyze resumes')
      setIsSubmitting(false)
    }
  }

  const handleDeleteAnalysis = async (analysisId, analysisName) => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) {
      setDeleteFeedback({ type: 'error', message: 'Authentication required.' })
      return
    }

    const confirmed = window.confirm(`Delete analysis "${analysisName || 'Untitled analysis'}"? This removes analysis history only and cannot be undone.`)
    if (!confirmed) return

    const previousItems = items
    setDeletingAnalysisId(analysisId)
    setDeleteFeedback({ type: '', message: '' })
    setItems((current) => current.filter((entry) => String(entry.id) !== String(analysisId)))

    try {
      const response = await fetch(`${API_BASE}/analyses/${analysisId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to delete analysis')

      setDeleteFeedback({ type: 'success', message: 'Analysis deleted successfully.' })
      const refreshedItems = await loadAnalyses()
      setItems(refreshedItems)
    } catch (deleteError) {
      setItems(previousItems)
      setDeleteFeedback({ type: 'error', message: deleteError.message || 'Unable to delete analysis' })
    } finally {
      setDeletingAnalysisId('')
    }
  }


  return (
    <main className="analyses-layout">
      <section className="analyses-layout__content">
        <div className="analyses-page__header"><div><h1>Analyses</h1><p>Track existing analyses and launch a new one in seconds.</p></div><button type="button" className="btn-primary" onClick={() => setIsCreateModalOpen(true)} ref={createButtonRef}>Create analysis</button></div>

        {deleteFeedback.message && <p role="status" className={`analyses-layout__state ${deleteFeedback.type === 'error' ? 'analyses-layout__state--error' : 'analyses-layout__state--success'}`}>{deleteFeedback.message}</p>}

        <div className="analyses-layout__table-shell">
          {loading && <p className="analyses-layout__state analyses-layout__state--loading">Loading analyses…</p>}
          {!loading && error && <p role="alert" className="analyses-layout__state analyses-layout__state--error">{error}</p>}
          {!loading && !error && sortedItems.length === 0 && <p className="analyses-layout__state analyses-layout__state--empty">No analyses yet. Upload resumes to create your first run.</p>}

          {!loading && !error && sortedItems.length > 0 && (
            <table className="analyses-layout__table">
              <thead><tr><th>Analysis name</th><th>Created</th><th>Status</th><th>Job description</th><th>Actions</th></tr></thead>
              <tbody>
                {pagedItems.map((analysis) => {
                  const status = deriveDisplayStatus(analysis)
                  const isNavigable = status === 'complete' || status === 'completed' || status === 'partial'

                  return (
                    <tr key={analysis.id} className="analyses-layout__row">
                      <td className="analyses-layout__cell analyses-layout__cell--name" data-label="Analysis">
                        {isNavigable ? (
                          <a className="analyses-layout__title-link analyses-layout__open-link" href={`/analyses/${analysis.id}`}>
                            <span className="analyses-layout__title">{analysis.name || 'Untitled analysis'}</span>
                          </a>
                        ) : (
                          <div className="analyses-layout__title-block">
                            <span className="analyses-layout__title">{analysis.name || 'Untitled analysis'}</span>
                          </div>
                        )}
                      </td>
                      <td className="analyses-layout__cell analyses-layout__cell--created" data-label="Created">
                        <span className="analyses-layout__meta">{formatDate(analysis.createdAt)}</span>
                      </td>
                      <td className="analyses-layout__cell analyses-layout__cell--status" data-label="Status">
                        <div className="analyses-layout__status-display">
                          <span className={`analyses-layout__status-badge analyses-layout__status-badge--${status}`}>{status}</span>
                          <StatusSummaryPopover
                            analysis={analysis}
                            isOpen={openSummaryPopoverId === analysis.id}
                            onOpen={() => setOpenSummaryPopoverId(analysis.id)}
                            onClose={() => setOpenSummaryPopoverId(null)}
                            popoverId={`analysis-summary-popover-${analysis.id}`}
                          />
                        </div>
                      </td>
                      <td className="analyses-layout__cell analyses-layout__cell--jd" data-label="Job description">
                        <span className="analyses-layout__meta">{analysis.jobDescriptionTitle || 'No job description'}</span>
                      </td>
                      <td className="analyses-layout__cell" data-label="Actions">
                        <button
                          type="button"
                          className="hf-btn hf-btn--secondary"
                          onClick={() => handleDeleteAnalysis(String(analysis.id), analysis.name)}
                          disabled={deletingAnalysisId === String(analysis.id)}
                        >
                          {deletingAnalysisId === String(analysis.id) ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {shouldRenderPaginationControls && (
            <nav aria-label="Analyses pagination">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </button>
              <span aria-live="polite">Page {currentPage} of {totalPages}</span>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </button>
            </nav>
          )}
        </div>
      </section>

      <CreateAnalysisModal
        isOpen={isCreateModalOpen}
        isSubmitting={isSubmitting}
        analysisName={analysisName}
        onAnalysisNameChange={setAnalysisName}
        selectedJobDescriptionId={selectedJobDescriptionId}
        onSelectedJobDescriptionIdChange={setSelectedJobDescriptionId}
        jobDescriptions={jobDescriptions}
        onFileSelection={handleFileSelection}
        onFilesSelected={handleFilesSelected}
        selectedFiles={selectedFiles}
        validationErrors={validationErrors}
        submitError={submitError}
        onSubmit={handleSubmit}
        onClose={resetModal}
        nameInputRef={nameInputRef}
        isDraggingOverDropzone={isDraggingOverDropzone}
        onDraggingOverDropzoneChange={setIsDraggingOverDropzone}
        onRemoveSelectedFile={handleRemoveSelectedFile}
      />
    </main>
  )
}

function CreateAnalysisModal({ isOpen, isSubmitting, analysisName, onAnalysisNameChange, selectedJobDescriptionId, onSelectedJobDescriptionIdChange, jobDescriptions, onFileSelection, onFilesSelected, selectedFiles, validationErrors, submitError, onSubmit, onClose, nameInputRef, isDraggingOverDropzone, onDraggingOverDropzoneChange, onRemoveSelectedFile }) {
  const dialogRef = useRef(null)
  const fileInputRef = useRef(null)

  const setDropzoneDragging = (isDragging) => onDraggingOverDropzoneChange(Boolean(isDragging))

  const handleDrop = (event) => {
    event.preventDefault()
    setDropzoneDragging(false)
    if (isSubmitting) return
    const droppedFiles = Array.from(event.dataTransfer?.files || [])
    onFilesSelected(droppedFiles)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    if (!isOpen) return undefined
    nameInputRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSubmitting, onClose, nameInputRef])

  if (!isOpen) return null

  return createPortal(
    <div className="ui-modal analyses-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-analysis-title" aria-describedby="create-analysis-description" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose() }}>
      <div ref={dialogRef} className="ui-card ui-card--card-spacing ui-modal__dialog analyses-create-modal__dialog">
        <div className="analyses-modal__header"><div><h2 id="create-analysis-title">Create analysis</h2><p id="create-analysis-description" className="analyses-modal__description">Upload resumes and choose an optional job description to start ranking candidates.</p></div><button type="button" className="analyses-modal__close" aria-label="Close create analysis modal" onClick={onClose} disabled={isSubmitting}><X size={18} strokeWidth={1.5} aria-hidden="true" /></button></div>
        <form onSubmit={onSubmit} className="analyses-modal__form" noValidate>
          <div className="analyses-modal__field"><label htmlFor="analysis-name">Analysis name</label><input className="analyses-modal__control" ref={nameInputRef} id="analysis-name" value={analysisName} onChange={(event) => onAnalysisNameChange(event.target.value)} aria-invalid={Boolean(validationErrors.name)} aria-describedby={validationErrors.name ? 'analysis-name-error' : undefined} />{validationErrors.name && <p id="analysis-name-error" role="alert" className="analyses-modal__error">{validationErrors.name}</p>}</div>
          <div className="analyses-modal__field"><label htmlFor="analysis-jd">Job description <span>(optional)</span></label><select className="analyses-modal__control" id="analysis-jd" value={selectedJobDescriptionId} onChange={(event) => onSelectedJobDescriptionIdChange(event.target.value)}><option value="">{ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL}</option>{jobDescriptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
          <div className="analyses-modal__field"><label htmlFor="analysis-files">Resume files</label><input ref={fileInputRef} className="analyses-modal__input-hidden" id="analysis-files" type="file" multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onFileSelection} aria-invalid={Boolean(validationErrors.files)} aria-describedby={validationErrors.files ? 'analysis-files-error' : 'analysis-files-help'} /><div className={`analyses-modal__dropzone${isDraggingOverDropzone ? ' is-dragging' : ''}${validationErrors.files ? ' is-invalid' : ''}`} onDragEnter={(event) => { event.preventDefault(); if (!isSubmitting) setDropzoneDragging(true) }} onDragOver={(event) => { event.preventDefault(); if (!isSubmitting) setDropzoneDragging(true) }} onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget.contains(event.relatedTarget)) return; setDropzoneDragging(false) }} onDrop={handleDrop}><Upload size={18} strokeWidth={1.5} aria-hidden="true" /><p className="analyses-modal__dropzone-title">Drag and drop resumes here</p><p id="analysis-files-help" className="analyses-modal__help">PDF or DOCX · Up to 20 files · 100MB each</p><button type="button" className="hf-btn hf-btn--secondary analyses-modal__browse-btn" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}>Browse files</button></div>{selectedFiles.length > 0 && <div className="analyses-modal__selected-files"><p className="analyses-modal__selected-count">{selectedFiles.length} file(s) selected</p><ul>{selectedFiles.map((file) => <li key={getFileKey(file)}><span>{file.name}</span><button type="button" className="analyses-modal__file-remove" onClick={() => onRemoveSelectedFile(getFileKey(file))} aria-label={`Remove ${file.name}`}>×</button></li>)}</ul></div>}{validationErrors.files && <p id="analysis-files-error" role="alert" className="analyses-modal__error">{validationErrors.files}</p>}</div>
          {submitError && <p role="alert" className="analyses-modal__error">{submitError}</p>}
          <div className="analyses-modal__actions"><button type="button" className="hf-btn hf-btn--secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button><button type="submit" className="hf-btn hf-btn--primary" disabled={isSubmitting}>{isSubmitting ? 'Analyzing…' : 'Analyze resumes'}</button></div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

function StatusSummaryPopover({ analysis, isOpen, onOpen, onClose, popoverId }) {
  const anchorRef = useRef(null)
  const popoverRef = useRef(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const summary = analysis?.summary
  const failedItems = Array.isArray(analysis?.failedItems) ? analysis.failedItems : []
  const hasFailed = Number(summary?.failed || 0) > 0

  useEffect(() => {
    if (!isOpen) return undefined
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const maxLeft = Math.max(16, window.innerWidth - 16 - 320)
      setPosition({
        top: Math.round(rect.bottom + window.scrollY + 8),
        left: Math.round(Math.min(Math.max(16, rect.left + window.scrollX - 140), maxLeft)),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !popoverRef.current) return
    popoverRef.current.style.top = `${position.top}px`
    popoverRef.current.style.left = `${position.left}px`
  }, [isOpen, position])

  return (
    <span className="analyses-status-summary" data-summary-popover-root="true">
      <button
        ref={anchorRef}
        type="button"
        className="analyses-status-summary__trigger"
        aria-label="View analysis status details"
        aria-expanded={isOpen}
        aria-controls={popoverId}
        onMouseEnter={onOpen}
        onFocus={onOpen}
        onClick={() => (isOpen ? onClose() : onOpen())}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {isOpen && createPortal(
        <div id={popoverId} ref={popoverRef} role="dialog" className="analyses-status-summary__popover" data-summary-popover-root="true">
          {!summary ? (
            <p className="analyses-status-summary__empty">No file summary available yet.</p>
          ) : (
            <>
              <dl className="analyses-status-summary__list">
                <div><dt>Total</dt><dd>{Number(summary.total || 0)}</dd></div>
                <div><dt>Completed</dt><dd>{Number(summary.complete || 0)}</dd></div>
                <div><dt>Failed</dt><dd>{Number(summary.failed || 0)}</dd></div>
                <div><dt>Processing</dt><dd>{Number(summary.processing || 0)}</dd></div>
                <div><dt>Pending</dt><dd>{Number(summary.pending || 0)}</dd></div>
              </dl>
              {hasFailed && (
                <div className="analyses-status-summary__failures">
                  <p>Failed files:</p>
                  {failedItems.length === 0 ? (
                    <p className="analyses-status-summary__empty">Failed files unavailable yet.</p>
                  ) : (
                    <ul>
                      {failedItems.map((item, index) => (
                        <li key={`${item.filename || 'unknown'}-${index}`}>
                          <span>{item.filename || 'Unknown file'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </span>
  )
}
