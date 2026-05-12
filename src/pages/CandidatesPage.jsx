import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import '../styles/candidates-directory.css'

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
  sortBySkillMatch: 'score',
}

const compactFilterKeys = ['search', 'job', 'scoreMin', 'experienceMin', 'skills', 'sortBySkillMatch']
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
  sortBySkillMatch: {
    label: 'Sort',
    type: 'select',
    options: [
      { label: 'Top score', value: 'score' },
      { label: 'Best skill match', value: 'skillMatch' },
      { label: 'Most experience', value: 'experience' },
      { label: 'Latest analyzed', value: 'recent' },
    ],
  },
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
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
  const [bulkStatus, setBulkStatus] = useState('')

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (String(value || '').trim()) params.set(key, String(value).trim())
    })
    return params.toString()
  }, [filters])

  const selectedCount = selectedResumeIds.length

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
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setError(loadError.message || 'Unable to load candidates')
          setCandidates([])
        }
      } finally { setIsLoading(false) }
    }
    loadCandidates()
    return () => controller.abort()
  }, [queryString])

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
        if (loadError.name !== 'AbortError') setBulkStatus(loadError.message || 'Unable to load shortlists')
      }
    }
    loadShortlists()
    return () => controller.abort()
  }, [selectedShortlistId])

  const toggleSelectedCandidate = (resumeId) => {
    setSelectedResumeIds((current) => (current.includes(resumeId) ? current.filter((id) => id !== resumeId) : [...current, resumeId]))
  }

  const runBulkShortlistAction = async (mode) => {
    if (!selectedShortlistId) return setBulkStatus('Select a shortlist first.')
    if (!selectedCount) return setBulkStatus('Select at least one candidate to run a bulk action.')
    try {
      setBulkStatus('')
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
      setBulkStatus(mode === 'add' ? `Bulk add complete: ${summary.added || 0} added, ${summary.updated || 0} updated, ${summary.failed || 0} failed.` : `Bulk remove complete: ${summary.removed || 0} removed, ${summary.notPresent || 0} not present.`)
      setSelectedResumeIds([])
    } catch (bulkError) { setBulkStatus(bulkError.message || 'Bulk shortlist action failed') }
  }

  const renderFilterField = (key) => {
    const config = candidateFilterFieldConfig[key] || {}
    return (
      <label key={key} className="candidates-directory__filter-field">
        <span>{config.label || key}</span>
        {config.type === 'select' ? (
          <select value={filters[key]} onChange={(event) => setFilters((prev) => ({ ...prev, [key]: event.target.value }))}>
            {config.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : (
          <input
            type={config.type || 'text'}
            inputMode={config.inputMode}
            min={config.min}
            max={config.max}
            step={config.step}
            value={filters[key]}
            onChange={(event) => setFilters((prev) => ({ ...prev, [key]: event.target.value }))}
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
        <p>Review talent, apply technical filters, and shortlist quickly.</p>
      </div>
      <div className="candidates-directory__chips" aria-label="Directory summary">
        <span className="chip">{candidates.length} total</span>
        <span className="chip">{selectedCount} selected</span>
        <span className="chip">{shortlists.length} shortlists</span>
      </div>
    </header>

    <section className="candidates-directory__filters" aria-label="Default candidate filters">{compactFilterKeys.map(renderFilterField)}</section>

    <details className="candidates-directory__advanced-filters">
      <summary>Advanced technical filters</summary>
      <section className="candidates-directory__filters" aria-label="Advanced candidate filters">{advancedFilterKeys.map(renderFilterField)}</section>
    </details>

    <section className="candidates-directory__bulk" aria-label="Bulk shortlist actions">
      <label className="candidates-directory__filter-field">
        <span>Shortlist</span>
        <select value={selectedShortlistId} onChange={(event) => setSelectedShortlistId(event.target.value)}>
          <option value="">Select shortlist</option>
          {shortlists.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.candidate_count || 0})</option>)}
        </select>
      </label>
      <button type="button" onClick={() => runBulkShortlistAction('add')}>Add selected</button>
      <button type="button" onClick={() => runBulkShortlistAction('remove')}>Remove selected</button>
    </section>

    {bulkStatus && <p className="candidates-directory__status">{bulkStatus}</p>}
    {error && <p className="candidates-directory__error">{error}</p>}
    {isLoading && <p className="candidates-directory__status">Loading candidates…</p>}
    {!isLoading && !error && candidates.length === 0 && <p className="candidates-directory__status">No candidates matched the current filters.</p>}

    <section className="candidates-directory__table-wrap" aria-live="polite">
      <table className="candidates-directory__table">
        <thead>
          <tr><th>Candidate</th><th>Job</th><th>Score</th><th>Experience</th><th>Skills</th><th>Shortlist / Status</th><th>Last analyzed</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => <tr key={candidate.resumeId}>
            <td><label className="candidate-select"><input type="checkbox" checked={selectedResumeIds.includes(candidate.resumeId)} onChange={() => toggleSelectedCandidate(candidate.resumeId)} />
              <span>{candidate.name || 'Candidate'}</span></label></td>
            <td>{candidate.associatedJob?.title || 'No linked job'}</td>
            <td>{candidate.profileScore ?? 'N/A'}</td>
            <td>{candidate.yearsExperience ?? 'N/A'} yrs</td>
            <td>{(candidate.skills || []).slice(0, 5).join(', ') || 'None listed'}</td>
            <td>{(candidate.tags || []).join(', ') || 'Unassigned'}</td>
            <td>{formatDate(candidate.sourceUpdatedAt)}</td>
            <td className="candidate-actions"><a href={`${API_BASE}/resumes/${candidate.resumeId}/view`} target="_blank" rel="noopener noreferrer">Resume</a><a href={`/candidates/${candidate.resumeId}`}>Profile</a></td>
          </tr>)}
        </tbody>
      </table>

      <div className="candidates-directory__cards">
        {candidates.map((candidate) => <article key={`card-${candidate.resumeId}`} className="candidate-directory-card">
          <label className="candidate-select"><input type="checkbox" checked={selectedResumeIds.includes(candidate.resumeId)} onChange={() => toggleSelectedCandidate(candidate.resumeId)} /><span>{candidate.name || 'Candidate'}</span></label>
          <p><strong>Job:</strong> {candidate.associatedJob?.title || 'No linked job'}</p>
          <p><strong>Score:</strong> {candidate.profileScore ?? 'N/A'}</p><p><strong>Experience:</strong> {candidate.yearsExperience ?? 'N/A'} yrs</p>
          <p><strong>Skills:</strong> {(candidate.skills || []).slice(0, 5).join(', ') || 'None listed'}</p>
          <p><strong>Status:</strong> {(candidate.tags || []).join(', ') || 'Unassigned'}</p>
          <p><strong>Last analyzed:</strong> {formatDate(candidate.sourceUpdatedAt)}</p>
          <p className="candidate-actions"><a href={`${API_BASE}/resumes/${candidate.resumeId}/view`} target="_blank" rel="noopener noreferrer">Resume</a><a href={`/candidates/${candidate.resumeId}`}>Profile</a></p>
        </article>)}
      </div>
    </section>
  </main>
}
