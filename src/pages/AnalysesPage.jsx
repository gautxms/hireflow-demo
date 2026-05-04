import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import { ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL, toOptionalJobDescriptionId } from '../components/resumeUploaderState'

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
  return String(status || 'pending').toLowerCase()
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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [jobDescriptions, setJobDescriptions] = useState([])
  const [analysisName, setAnalysisName] = useState('')
  const [selectedJobDescriptionId, setSelectedJobDescriptionId] = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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
    if (!isModalOpen) return
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
  }, [isModalOpen])

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [items],
  )

  const resetModal = () => {
    setIsModalOpen(false)
    setAnalysisName('')
    setSelectedJobDescriptionId('')
    setSelectedFiles([])
    setSubmitError('')
    setIsSubmitting(false)
  }

  const handleFileSelection = (event) => {
    const incomingFiles = Array.from(event.target.files || [])
    const allowed = []
    const rejected = []

    incomingFiles.forEach((file, index) => {
      if ((allowed.length + 1) > MAX_FILE_COUNT) {
        if (index === incomingFiles.length - 1 || rejected.length === 0) rejected.push(`Maximum ${MAX_FILE_COUNT} files per analysis.`)
        return
      }
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
      allowed.push(file)
    })

    setSelectedFiles(allowed)
    setSubmitError(rejected.length > 0 ? rejected.join(' ') : '')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const nameValue = analysisName.trim()
    if (!nameValue) {
      setSubmitError('Analysis name is required. Please enter a name before submitting.')
      return
    }
    if (selectedFiles.length === 0) {
      setSubmitError('Please select at least one resume file.')
      return
    }

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

  return (
    <main className="analyses-page">
      <section className="analyses-page__card">
        <div className="analyses-page__header"><div><h1>Analyses</h1><p>Historical upload analyses and their latest live statuses.</p></div><button type="button" className="btn-primary analyses-page__cta" onClick={() => setIsModalOpen(true)}>Create analysis</button></div>

        {loading && <p>Loading analyses…</p>}
        {!loading && error && <p role="alert">{error}</p>}
        {!loading && !error && sortedItems.length === 0 && <p>No analyses yet. Upload resumes to create your first run.</p>}
        {!loading && !error && sortedItems.length > 0 && (
          <table className="analyses-page__table">
            <thead><tr><th>Created</th><th>Live status</th><th>Summary</th><th>Job description</th><th>Open</th></tr></thead>
            <tbody>
              {sortedItems.map((analysis) => {
                const status = normalizeStatus(analysis.liveStatus || analysis.status)
                const summary = analysis.summary || {}
                return <tr key={analysis.id}><td>{formatDate(analysis.createdAt)}</td><td>{status}</td><td>Total {summary.total || 0} · Complete {summary.complete || 0} · Failed {summary.failed || 0} · Pending {(summary.pending || 0) + (summary.processing || 0)}</td><td>{analysis.jobDescriptionTitle || 'No job description'}</td><td><a href={`/analyses/${analysis.id}`}>View</a></td></tr>
              })}
            </tbody>
          </table>
        )}
      </section>

      {isModalOpen && (
        <div className="ui-modal" role="dialog" aria-modal="true" aria-label="Create analysis">
          <div className="ui-card ui-card--card-spacing ui-modal__dialog w-full max-w-lg">
            <h2>Create analysis</h2>
            <form onSubmit={handleSubmit}>
              <label htmlFor="analysis-name">Analysis name</label>
              <input id="analysis-name" value={analysisName} onChange={(event) => setAnalysisName(event.target.value)} />

              <label htmlFor="analysis-jd">Job description</label>
              <select id="analysis-jd" value={selectedJobDescriptionId} onChange={(event) => setSelectedJobDescriptionId(event.target.value)}>
                <option value="">{ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL}</option>
                {jobDescriptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>

              <label htmlFor="analysis-files">Resume files</label>
              <input id="analysis-files" type="file" multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileSelection} />
              {selectedFiles.length > 0 && <p>{selectedFiles.length} file(s) selected.</p>}
              {submitError && <p role="alert">{submitError}</p>}

              <div>
                <button type="button" className="hf-btn hf-btn--secondary" onClick={resetModal} disabled={isSubmitting}>Cancel</button>
                <button type="submit" className="hf-btn hf-btn--primary" disabled={isSubmitting}>{isSubmitting ? 'Analyzing…' : 'Analyze resumes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
