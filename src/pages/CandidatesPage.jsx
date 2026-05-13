import { useEffect, useMemo, useState } from 'react'
import StatePattern from '../components/state/StatePattern'
import API_BASE from '../config/api'
import { dedupeCandidatesByResumeId } from '../components/candidateSelectionState'
import { buildCandidatesDirectoryQueryParams, resolveCandidatesDirectoryUiState } from './candidatesDirectoryState'
import '../styles/candidates-directory.css'
import '../styles/ui-primitives.css'
import '../styles/app-route-states.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

const emptyFilters = {
  search: '',
  job: '',
  scoreMin: '',
  scoreMax: '',
  experienceMin: '',
  experienceMax: '',
  skills: '',
  tags: '',
  sourceJobId: '',
  sourceAnalysisId: '',
}

const compactFilterKeys = ['search', 'job', 'scoreMin', 'experienceMin', 'skills']
const advancedFilterKeys = ['scoreMax', 'experienceMax', 'tags', 'sourceJobId', 'sourceAnalysisId']

const candidateFilterFieldConfig = {
  search: { label: 'Search', placeholder: 'Name, summary, or skills' },
  job: { label: 'Job', placeholder: 'e.g. Senior Frontend Engineer' },
  skills: { label: 'Skill', placeholder: 'e.g. React, SQL' },
  experienceMin: { label: 'Min experience', placeholder: 'e.g. 3', type: 'number', inputMode: 'decimal', min: '0', step: '0.5' },
  experienceMax: { label: 'Max experience', placeholder: 'e.g. 12', type: 'number', inputMode: 'decimal', min: '0', step: '0.5' },
  scoreMin: { label: 'Min score', placeholder: 'e.g. 7', type: 'number', inputMode: 'decimal', min: '0', max: '10', step: '0.1' },
  scoreMax: { label: 'Max score', placeholder: 'e.g. 9.5', type: 'number', inputMode: 'decimal', min: '0', max: '10', step: '0.1' },
  tags: { label: 'Tags', placeholder: 'e.g. frontend, leadership' },
  sourceJobId: { label: 'Source job ID', placeholder: 'e.g. job_123' },
  sourceAnalysisId: { label: 'Source analysis ID', placeholder: 'e.g. parse_456' },
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not extracted'
  return date.toLocaleString()
}

export default function CandidatesPage() {
  const [filters, setFilters] = useState(emptyFilters)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [candidates, setCandidates] = useState([])
  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [selectedResumeIds, setSelectedResumeIds] = useState([])
  const [reloadKey, setReloadKey] = useState(0)
  const [bulkFeedback, setBulkFeedback] = useState({ type: 'info', message: '', detail: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalCount, setTotalCount] = useState(null)
  const [isDirectoryDataAvailable, setIsDirectoryDataAvailable] = useState(false)
  const [sortBy, setSortBy] = useState('recent')
  const [sortDirection, setSortDirection] = useState('desc')
  const [jobOptions, setJobOptions] = useState([])
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  const queryString = useMemo(() => buildCandidatesDirectoryQueryParams({ filters, page, pageSize, sortBy, sortDirection }).toString(), [filters, page, pageSize, sortBy, sortDirection])

  const hasActiveFilters = useMemo(() => Object.values(filters).some((value) => String(value || '').trim().length > 0), [filters])

  const selectedCount = selectedResumeIds.length
  const candidateRows = useMemo(() => {
    const { candidates: dedupedCandidates, duplicateResumeIds } = dedupeCandidatesByResumeId(candidates)
    if (duplicateResumeIds.length) {
      console.warn('[CandidatesPage] Duplicate resumeId entries were omitted from the client view model.', duplicateResumeIds)
    }
    return dedupedCandidates
  }, [candidates])

  useEffect(() => {
    const controller = new AbortController()
    async function loadCandidates() {
      try {
        setIsLoading(true)
        setError('')
        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        const response = await fetch(`${API_BASE}/candidates/directory${queryString ? `?${queryString}` : ''}`, {
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Unable to load candidates')
        setCandidates(Array.isArray(payload.candidates) ? payload.candidates : [])
        setTotalCount(Number(payload.totalCount ?? payload.meta?.totalCount ?? 0))
        setIsDirectoryDataAvailable(true)
        setPage(Number(payload.page ?? payload.meta?.page ?? page))
        setPageSize(Number(payload.pageSize ?? payload.meta?.pageSize ?? pageSize))
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setError(loadError.message || 'Unable to load candidates')
          setCandidates([])
          setTotalCount(null)
          setIsDirectoryDataAvailable(false)
        }
      } finally { setIsLoading(false) }
    }
    loadCandidates()
    return () => controller.abort()
  }, [queryString, reloadKey])

  useEffect(() => {
    const controller = new AbortController()
    async function loadShortlists() {
      try {
        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        const response = await fetch(`${API_BASE}/shortlists`, {
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Unable to load shortlists')
        const next = Array.isArray(payload.shortlists) ? payload.shortlists : []
        setShortlists(next)
        if (!selectedShortlistId && next[0]?.id) setSelectedShortlistId(next[0].id)
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setBulkFeedback({ type: 'error', message: loadError.message || 'Unable to load shortlists', detail: '' })
        }
      }
    }
    loadShortlists()
    return () => controller.abort()
  }, [selectedShortlistId])

  useEffect(() => {
    const controller = new AbortController()
    async function loadJobOptions() {
      try {
        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        const response = await fetch(`${API_BASE}/jobs`, {
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) return
        const jobs = Array.isArray(payload.jobs) ? payload.jobs : []
        const safeOptions = jobs
          .map((job) => ({
            value: String(job.jobId || job.id || '').trim(),
            label: String(job.title || job.role || '').trim(),
          }))
          .filter((job) => job.value && job.label)
        setJobOptions(safeOptions)
      } catch (loadError) {
        if (loadError.name !== 'AbortError') setJobOptions([])
      }
    }
    loadJobOptions()
    return () => controller.abort()
  }, [])

  const toggleSelectedCandidate = (resumeId) => {
    setSelectedResumeIds((current) => (current.includes(resumeId) ? current.filter((id) => id !== resumeId) : [...current, resumeId]))
  }

  useEffect(() => {
    if (!bulkFeedback.message) return undefined
    const timeoutId = window.setTimeout(() => setBulkFeedback((current) => ({ ...current, message: '', detail: '' })), 4500)
    return () => window.clearTimeout(timeoutId)
  }, [bulkFeedback.message])

  const runBulkShortlistAction = async (mode) => {
    if (!selectedShortlistId) return setBulkFeedback({ type: 'error', message: 'Select a shortlist first.', detail: '' })
    if (!selectedCount) return setBulkFeedback({ type: 'error', message: 'Select at least one candidate to run a bulk action.', detail: '' })
    try {
      setBulkFeedback({ type: 'info', message: '', detail: '' })
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      const endpoint = mode === 'add' ? `${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch` : `${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch-remove`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ resumeIds: selectedResumeIds, ...(mode === 'add' ? { notes: 'Added from candidates directory bulk action' } : {}) }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Bulk shortlist action failed')
      const summary = payload?.summary || {}
      const isAdd = mode === 'add'
      const message = isAdd
        ? `Bulk add complete: ${summary.added || 0} added, ${summary.updated || 0} updated, ${summary.failed || 0} failed.`
        : `Bulk remove complete: ${summary.removed || 0} removed, ${summary.notPresent || 0} not present.`
      const summaryErrorDetail = Array.isArray(summary.errors) && summary.errors.length
        ? `API summary errors: ${summary.errors.slice(0, 3).join('; ')}`
        : ''
      setBulkFeedback({ type: summary.failed > 0 ? 'error' : 'success', message, detail: summaryErrorDetail })
      setSelectedResumeIds([])
    } catch (bulkError) { setBulkFeedback({ type: 'error', message: bulkError.message || 'Bulk shortlist action failed', detail: '' }) }
  }

  const bulkActionsDisabled = !selectedShortlistId || !selectedCount
  const totalCountLabel = isDirectoryDataAvailable && typeof totalCount === 'number' ? totalCount : '—'
  const totalCountValue = typeof totalCount === 'number' ? totalCount : 0
  const totalPages = Math.max(1, Math.ceil(totalCountValue / pageSize))
  const hasSafeJobOptions = jobOptions.length > 0

  const hasCandidates = candidateRows.length > 0
  const {
    showLoadingState,
    showErrorState,
    showEmptyWithoutFilters,
    showEmptyWithFilters,
    showLoadedState,
  } = resolveCandidatesDirectoryUiState({ isLoading, error, hasCandidates, hasActiveFilters })

  const renderFilterField = (key) => {
    const config = candidateFilterFieldConfig[key] || {}
    return (
      <label key={key} className="candidates-directory__filter-field">
        <span>{config.label || key}</span>
        {config.type === 'select' ? (
          <select name={key} value={filters[key]} onChange={(event) => setFilters((prev) => ({ ...prev, [key]: event.target.value }))}>
            {config.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : key === 'job' && hasSafeJobOptions ? (
          <select name={key} value={filters[key]} onChange={(event) => { setFilters((prev) => ({ ...prev, [key]: event.target.value })); setPage(1) }}>
            <option value="">All jobs</option>
            {jobOptions.map((option) => <option key={option.value} value={option.label}>{option.label}</option>)}
          </select>
        ) : (
          <input
            name={key}
            type={config.type || 'text'}
            inputMode={config.inputMode}
            min={config.min}
            max={config.max}
            step={config.step}
            value={filters[key]}
            onChange={(event) => { setFilters((prev) => ({ ...prev, [key]: event.target.value })); setPage(1) }}
            placeholder={config.placeholder || `Filter by ${key}`}
          />
        )}
      </label>
    )
  }

  return <main className="candidates-directory">
    <header className="candidates-directory__header">
      <div>
        <h1>Candidates</h1>
        <p>Search and manage candidates across jobs, analyses, skills, and shortlists.</p>
      </div>
      <div className="candidates-directory__chips" aria-label="Directory summary">
        <span className="chip">{totalCountLabel} total</span>
        <span className="chip">{selectedCount} selected</span>
        <span className="chip">{shortlists.length} shortlists</span>
      </div>
    </header>

    <section className="candidates-directory__filters" aria-label="Default candidate filters">{compactFilterKeys.map(renderFilterField)}</section>

    {hasActiveFilters && <button type="button" className="hf-btn hf-btn--secondary candidates-directory__clear-filters" onClick={() => { setFilters(emptyFilters); setPage(1) }}>Clear filters</button>}

    <section className="candidates-directory__advanced-filters">
      <button
        type="button"
        className="candidates-directory__advanced-trigger hf-btn hf-btn--tertiary"
        aria-expanded={showAdvancedFilters}
        onClick={() => setShowAdvancedFilters((current) => !current)}
      >
        <span aria-hidden="true" className="candidates-directory__advanced-trigger-icon">{showAdvancedFilters ? '▾' : '▸'}</span>
        Advanced technical filters
      </button>
      {showAdvancedFilters && <section className="candidates-directory__filters" aria-label="Advanced candidate filters">{advancedFilterKeys.map(renderFilterField)}</section>}
    </section>

    {selectedCount > 0 && (<section className="candidates-directory__bulk" aria-label="Bulk shortlist actions">
      <span className="chip" aria-live="polite">{selectedCount} selected</span>
      <label className="candidates-directory__filter-field">
        <span>Shortlist</span>
        <select className="candidates-directory__shortlist-select" value={selectedShortlistId} onChange={(event) => setSelectedShortlistId(event.target.value)}>
          <option value="">Select shortlist</option>
          {shortlists.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.candidate_count || 0})</option>)}
        </select>
      </label>
        <button type="button" className="hf-btn hf-btn--primary" onClick={() => runBulkShortlistAction('add')} disabled={bulkActionsDisabled}>Add selected</button>
        <button type="button" className="hf-btn hf-btn--secondary" onClick={() => runBulkShortlistAction('remove')} disabled={bulkActionsDisabled}>Remove selected</button>
    </section>)}
    {bulkFeedback.message && <p className={`candidates-directory__status candidates-directory__status--${bulkFeedback.type}`} role="status" aria-live="polite">{bulkFeedback.message}</p>}
    {bulkFeedback.detail && <p className="candidates-directory__status candidates-directory__status--error" role="alert">{bulkFeedback.detail}</p>}
    {bulkFeedback.message && <div className={`candidates-directory__toast candidates-directory__toast--${bulkFeedback.type}`} role="status" aria-live="polite">{bulkFeedback.message}</div>}
    {showLoadingState && (
      <section className="candidates-directory__table-wrap" aria-live="polite" aria-busy="true">
        <div className="candidates-directory__cards">
          {Array.from({ length: 5 }).map((_, idx) => (
            <article key={`loading-card-${idx}`} className="candidate-directory-card" aria-hidden="true">
              <div className="chip">Loading candidate…</div>
              <p><strong>Candidate:</strong> <span className="chip">Fetching profile</span></p>
              <p><strong>Job:</strong> <span className="chip">Loading role fit</span></p>
              <p><strong>Skills:</strong> <span className="chip">Loading skills</span></p>
            </article>
          ))}
        </div>
      </section>
    )}

    {showErrorState && (
      <StatePattern
        kind="error"
        title="Couldn’t load candidates"
        description={error}
        action={<button type="button" className="hf-btn hf-btn--primary" onClick={() => setReloadKey((current) => current + 1)}>Retry</button>}
      />
    )}

    {showEmptyWithoutFilters && (
      <StatePattern
        kind="empty"
        title="No candidates yet"
        description="Candidate records will appear here once resumes are analyzed and enriched."
      />
    )}

    {showEmptyWithFilters && (
      <StatePattern
        kind="empty"
        title="No matches for these filters"
        description="Try broadening your search criteria or clear one or more filters."
        action={<button type="button" className="hf-btn hf-btn--secondary" onClick={() => { setFilters(emptyFilters); setPage(1) }}>Clear filters</button>}
      />
    )}

    {showLoadedState && (
      <>
      <div className="candidates-directory__table-toolbar" aria-label="Candidates table controls">
        <div className="candidates-directory__toolbar-group">
          <label className="candidates-directory__filter-field" htmlFor="candidates-sort-by">
            <span>Sort by</span>
            <select id="candidates-sort-by" className="candidates-directory__shortlist-select" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1) }} aria-label="Sort candidates by">
            <option value="recent">Latest analyzed</option>
            <option value="score">Top score</option>
            <option value="experience">Most experience</option>
            <option value="name">Name A–Z</option>
          </select>
          </label>
          <label className="candidates-directory__filter-field" htmlFor="candidates-sort-direction">
            <span>Direction</span>
            <select id="candidates-sort-direction" className="candidates-directory__shortlist-select" value={sortDirection} onChange={(event) => { setSortDirection(event.target.value); setPage(1) }} aria-label="Sort direction">
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
        </div>
        <div className="candidates-directory__toolbar-group">
          <label className="candidates-directory__filter-field" htmlFor="candidates-page-size">
            <span>Page size</span>
            <select id="candidates-page-size" className="candidates-directory__shortlist-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} aria-label="Candidates per page">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </label>
          <button type="button" aria-label="Go to previous page" className="hf-btn hf-btn--secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button>
          <span className="chip" aria-live="polite">Page {page} of {totalPages}</span>
          <button type="button" aria-label="Go to next page" className="hf-btn hf-btn--secondary" onClick={() => setPage((current) => (current < totalPages ? current + 1 : current))} disabled={page >= totalPages}>Next</button>
        </div>
      </div>

    <section className="candidates-directory__table-wrap" aria-live="polite">
      <table className="candidates-directory__table">
        <thead>
          <tr><th aria-label="Select candidate" /><th>Candidate</th><th>Job</th><th>Score</th><th>Experience</th><th>Skills</th><th>Shortlist / Status</th><th>Last analyzed</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {candidateRows.map((candidate) => <tr key={candidate.resumeId}>
            <td><label className="candidate-select"><input type="checkbox" aria-label={`Select ${candidate.name || 'candidate'}`} checked={selectedResumeIds.includes(candidate.resumeId)} onChange={() => toggleSelectedCandidate(candidate.resumeId)} /></label></td>
            <td>{candidate.name || 'Candidate'}</td>
            <td>{candidate.associatedJob?.title || 'No linked job'}</td>
            <td>{candidate.profileScore ?? 'Score pending'}</td>
            <td>{candidate.yearsExperience != null ? `${candidate.yearsExperience} yrs` : 'Experience unavailable'}</td>
            <td>{(candidate.skills || []).slice(0, 5).join(', ') || 'None listed'}</td>
            <td>{(candidate.tags || []).join(', ') || 'Unassigned'}</td>
            <td>{formatDate(candidate.sourceUpdatedAt)}</td>
            <td className="candidate-actions"><a href={`${API_BASE}/resumes/${candidate.resumeId}/view`} target="_blank" rel="noopener noreferrer">Resume</a><a href={`/candidates/${candidate.resumeId}`}>Profile</a></td>
          </tr>)}
        </tbody>
      </table>

      <div className="candidates-directory__cards"> {candidateRows.map((candidate) => <article key={`card-${candidate.resumeId}`} className="candidate-directory-card">
          <label className="candidate-select"><input type="checkbox" aria-label={`Select ${candidate.name || 'candidate'}`} checked={selectedResumeIds.includes(candidate.resumeId)} onChange={() => toggleSelectedCandidate(candidate.resumeId)} /></label>
          <p><strong>Candidate:</strong> {candidate.name || 'Candidate'}</p>
          <p><strong>Job:</strong> {candidate.associatedJob?.title || 'No linked job'}</p>
          <p><strong>Score:</strong> {candidate.profileScore ?? 'Score pending'}</p><p><strong>Experience:</strong> {candidate.yearsExperience != null ? `${candidate.yearsExperience} yrs` : 'Experience unavailable'}</p>
          <p><strong>Skills:</strong> {(candidate.skills || []).slice(0, 5).join(', ') || 'None listed'}</p>
          <p><strong>Status:</strong> {(candidate.tags || []).join(', ') || 'Unassigned'}</p>
          <p><strong>Last analyzed:</strong> {formatDate(candidate.sourceUpdatedAt)}</p>
          <p className="candidate-actions"><a href={`${API_BASE}/resumes/${candidate.resumeId}/view`} target="_blank" rel="noopener noreferrer">Resume</a><a href={`/candidates/${candidate.resumeId}`}>Profile</a></p>
        </article>)} </div>
    </section>
      </>
    )}
  </main>
}
