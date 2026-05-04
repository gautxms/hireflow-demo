import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const MAX_NAME_LENGTH = 80

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function normalizeStatus(status) {
  return String(status || 'pending').toLowerCase()
}

export default function AnalysesPage({ onCreateAnalysis }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [jobDescriptions, setJobDescriptions] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [analysisName, setAnalysisName] = useState('')
  const [jobDescriptionId, setJobDescriptionId] = useState('')
  const [files, setFiles] = useState([])

  const loadAnalyses = async (signal) => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) throw new Error('Authentication required.')
    const response = await fetch(`${API_BASE}/analyses`, { headers: { Authorization: `Bearer ${token}` }, signal })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Unable to load analyses')
    setItems(Array.isArray(payload.items) ? payload.items : [])
  }

  useEffect(() => {
    const controller = new AbortController()
    loadAnalyses(controller.signal).catch((e) => setError(e.message)).finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) return
    fetch(`${API_BASE}/job-descriptions`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json().then((p) => ({ ok: r.ok, p })))
      .then(({ ok, p }) => {
        if (!ok) return
        const eligible = (Array.isArray(p.items) ? p.items : []).filter((item) => item.status === 'active' || item.status === 'draft')
        setJobDescriptions(eligible)
        if (eligible.length > 0) setJobDescriptionId(String(eligible[0].id))
      })
      .catch(() => setJobDescriptions([]))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('create') === '1') {
      setIsModalOpen(true)
      params.delete('create')
      const next = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`)
    }
  }, [])

  useEffect(() => {
    const poll = setInterval(() => {
      loadAnalyses().catch(() => {})
    }, 5000)
    return () => clearInterval(poll)
  }, [])

  const sortedItems = useMemo(() => [...items].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()), [items])

  const submit = async () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    const trimmedName = analysisName.trim()
    if (!trimmedName) return setFormError('Analysis name is required.')
    if (trimmedName.length > MAX_NAME_LENGTH) return setFormError(`Analysis name must be ${MAX_NAME_LENGTH} characters or fewer.`)
    if (!jobDescriptionId) return setFormError('Select a job description.')
    if (files.length === 0) return setFormError('Upload at least one resume.')

    setIsSubmitting(true)
    setFormError('')
    const optimistic = {
      id: `tmp-${Date.now()}`,
      name: trimmedName,
      createdAt: new Date().toISOString(),
      liveStatus: 'queued',
      status: 'queued',
      summary: { total: files.length, queued: files.length, processing: 0, complete: 0, failed: 0 },
      jobDescriptionTitle: jobDescriptions.find((j) => String(j.id) === String(jobDescriptionId))?.title || '—',
    }
    setItems((prev) => [optimistic, ...prev])

    try {
      const form = new FormData()
      form.append('name', trimmedName)
      form.append('jobDescriptionId', jobDescriptionId)
      files.forEach((file) => form.append('resumes', file))
      const response = await fetch(`${API_BASE}/analyses`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to create analysis')
      setItems((prev) => [payload.analysis, ...prev.filter((item) => item.id !== optimistic.id)])
      setIsModalOpen(false)
      setAnalysisName('')
      setFiles([])
      window.history.replaceState({}, '', '/analyses')
    } catch (e) {
      setItems((prev) => prev.filter((item) => item.id !== optimistic.id))
      setFormError(`${e.message || 'Unable to create analysis'}. Return to analyses or Retry.`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return <main className="route-state"><section className="route-state-card"><div className="analyses-page__header"><div><h1>Analyses</h1><p>Historical upload analyses and their latest live statuses.</p></div><button type="button" className="btn-primary" onClick={() => { setIsModalOpen(true); onCreateAnalysis?.() }}>Create analysis</button></div>
    {loading && <p>Loading analyses…</p>}
    {!loading && error && <p role="alert">{error}</p>}
    {!loading && !error && sortedItems.length === 0 && <p>No analyses yet. Create your first run.</p>}
    {!loading && !error && sortedItems.length > 0 && <table><thead><tr><th>Name</th><th>Created</th><th>Live status</th><th>Summary</th><th>Job description</th><th>Open</th></tr></thead><tbody>{sortedItems.map((analysis) => { const status = normalizeStatus(analysis.liveStatus || analysis.status); const summary = analysis.summary || {}; return <tr key={analysis.id}><td>{analysis.name || 'Untitled analysis'}</td><td>{formatDate(analysis.createdAt)}</td><td>{status}</td><td>Total {summary.total || 0} · Complete {summary.complete || 0} · Failed {summary.failed || 0} · Pending {(summary.pending || 0) + (summary.processing || 0)}</td><td>{analysis.jobDescriptionTitle || 'No job description'}</td><td><a href={`/analyses/${analysis.id}`}>View</a></td></tr> })}</tbody></table>}

    {isModalOpen && <div role="dialog" aria-modal="true" className="route-state-card analyses-page__modal" ><h2>Create analysis</h2>
      <label>Analysis name<input value={analysisName} maxLength={MAX_NAME_LENGTH} onChange={(e) => setAnalysisName(e.target.value)} /></label>
      <label>Job description<select value={jobDescriptionId} onChange={(e) => setJobDescriptionId(e.target.value)}>{jobDescriptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Upload resumes<input type="file" multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFiles(Array.from(e.target.files || []))} /></label>
      <p>{files.length} file(s) selected.</p>
      {formError && <p role="alert">{formError}</p>}
      <div><button type="button" onClick={() => setIsModalOpen(false)}>Return to analyses</button><button type="button" disabled={isSubmitting} onClick={submit}>{isSubmitting ? 'Analyzing…' : 'Analyze resumes'}</button></div>
    </div>}
  </section></main>
}
