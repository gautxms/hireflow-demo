import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import { buildCandidateDirectoryQueryParams } from '../schemas/candidateDirectoryQuerySchema'
import '../styles/candidates-directory.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

const emptyFilters = {
  skills: '',
  experienceMin: '',
  experienceMax: '',
  scoreMin: '',
  scoreMax: '',
  tags: '',
  sourceJobId: '',
  sourceAnalysisId: '',
}

const sortOptions = [
  { value: 'updated_desc', label: 'Newest analysis' },
  { value: 'score_desc', label: 'Highest score' },
  { value: 'experience_desc', label: 'Most experience' },
  { value: 'name_asc', label: 'Name (A-Z)' },
]

function getScoreLabel(candidate) {
  if (candidate.profileScore !== null && candidate.profileScore !== undefined) {
    return String(candidate.profileScore)
  }
  return 'Score pending'
}

function getExperienceLabel(candidate) {
  if (candidate.yearsExperience !== null && candidate.yearsExperience !== undefined) {
    return `${candidate.yearsExperience} years`
  }
  return 'Experience unavailable'
}

function getSkillsLabel(candidate) {
  const listedSkills = Array.isArray(candidate.skills) ? candidate.skills.slice(0, 6) : []
  if (listedSkills.length > 0) {
    return listedSkills.join(', ')
  }
  return 'Not extracted'
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }
  return date.toLocaleString()
}

export default function CandidatesPage() {
  const [filters, setFilters] = useState(emptyFilters)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('updated_desc')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [candidates, setCandidates] = useState([])
  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [selectedResumeIds, setSelectedResumeIds] = useState([])
  const [bulkStatus, setBulkStatus] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)

  const queryString = useMemo(() => {
    return buildCandidateDirectoryQueryParams({
      search: [filters.skills, filters.tags].filter(Boolean).join(' ').trim() || null,
      job: filters.sourceJobId,
      skills: filters.skills,
      tags: filters.tags,
      experienceMin: filters.experienceMin,
      experienceMax: filters.experienceMax,
      scoreMin: filters.scoreMin,
      scoreMax: filters.scoreMax,
      sourceJobId: filters.sourceJobId,
      sourceAnalysisId: filters.sourceAnalysisId,
      sortBy: 'sourceUpdatedAt',
      sortDirection: 'desc',
      page: 1,
      pageSize: 25,
    })
  }, [filters])

  useEffect(() => {
    const controller = new AbortController()

    async function loadCandidates() {
      try {
        setIsLoading(true)
        setError('')

        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        const response = await fetch(`${API_BASE}/candidates/directory${queryString ? `?${queryString}` : ''}`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        })

        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load candidates')
        }

        setCandidates(Array.isArray(payload.candidates) ? payload.candidates : [])
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setError(loadError.message || 'Unable to load candidates')
          setCandidates([])
        }
      } finally {
        setIsLoading(false)
      }
    }

    loadCandidates()
    return () => controller.abort()
  }, [queryString, reloadNonce])

  useEffect(() => {
    const controller = new AbortController()

    async function loadShortlists() {
      try {
        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        const response = await fetch(`${API_BASE}/shortlists`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load shortlists')
        }
        const next = Array.isArray(payload.shortlists) ? payload.shortlists : []
        setShortlists(next)
        if (!selectedShortlistId && next[0]?.id) {
          setSelectedShortlistId(next[0].id)
        }
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setBulkStatus(loadError.message || 'Unable to load shortlists')
        }
      }
    }

    loadShortlists()
    return () => controller.abort()
  }, [selectedShortlistId])

  const visibleCandidates = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    const filtered = candidates.filter((candidate) => {
      if (!normalizedSearch) return true
      const haystack = [candidate.name, candidate.associatedJob?.title, ...(candidate.skills || []), ...(candidate.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedSearch)
    })

    return [...filtered].sort((a, b) => {
      if (sortBy === 'score_desc') return (b.profileScore ?? -1) - (a.profileScore ?? -1)
      if (sortBy === 'experience_desc') return (b.yearsExperience ?? -1) - (a.yearsExperience ?? -1)
      if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '')
      return new Date(b.sourceUpdatedAt).getTime() - new Date(a.sourceUpdatedAt).getTime()
    })
  }, [candidates, searchTerm, sortBy])


  const viewState = useMemo(() => {
    if (isLoading) return 'loading'
    if (error) return 'api-error'
    if (candidates.length === 0) return 'no-candidates'
    if (visibleCandidates.length === 0) return 'no-filter-results'
    return 'loaded'
  }, [isLoading, error, candidates.length, visibleCandidates.length])

  const retryLoadCandidates = () => {
    setReloadNonce((current) => current + 1)
  }

  const toggleSelectedCandidate = (resumeId) => {
    setSelectedResumeIds((current) => (
      current.includes(resumeId)
        ? current.filter((id) => id !== resumeId)
        : [...current, resumeId]
    ))
  }

  const runBulkShortlistAction = async (mode) => {
    if (!selectedShortlistId) return setBulkStatus('Select a shortlist first.')
    if (selectedResumeIds.length === 0) return setBulkStatus('Select at least one candidate to run a bulk action.')

    try {
      setBulkStatus('')
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      const endpoint = mode === 'add'
        ? `${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch`
        : `${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch-remove`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          resumeIds: selectedResumeIds,
          ...(mode === 'add' ? { notes: 'Added from candidates directory bulk action' } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Bulk shortlist action failed')

      const summary = payload?.summary || {}
      setBulkStatus(mode === 'add'
        ? `Bulk add complete: ${summary.added || 0} added, ${summary.updated || 0} updated, ${summary.failed || 0} failed.`
        : `Bulk remove complete: ${summary.removed || 0} removed, ${summary.notPresent || 0} not present.`)
      setSelectedResumeIds([])
    } catch (bulkError) {
      setBulkStatus(bulkError.message || 'Bulk shortlist action failed')
    }
  }

  return (
    <main className="candidates-directory">
      <header className="candidates-directory__hero">
        <div>
          <h1>Candidates Directory</h1>
          <p>Fast pipeline triage with structured scoring, skills intelligence, and shortlist actions.</p>
        </div>
        <div className="candidates-directory__summary-chips" aria-label="Directory summary">
          <span className="summary-chip">Total: {viewState === 'api-error' ? '—' : candidates.length}</span>
          <span className="summary-chip">Visible: {viewState === 'api-error' ? '—' : visibleCandidates.length}</span>
          <span className="summary-chip">Selected: {viewState === 'api-error' ? '—' : selectedResumeIds.length}</span>
        </div>
      </header>

      <section className="candidates-directory__toolbar" aria-label="Candidate search and quick filters">
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search name, tags, role, skills" />
        <input value={filters.sourceJobId} onChange={(e) => setFilters((p) => ({ ...p, sourceJobId: e.target.value }))} placeholder="Job ID" />
        <input value={filters.skills} onChange={(e) => setFilters((p) => ({ ...p, skills: e.target.value }))} placeholder="Skill" />
        <input type="number" min="0" max="10" step="0.1" value={filters.scoreMin} onChange={(e) => setFilters((p) => ({ ...p, scoreMin: e.target.value }))} placeholder="Min score" />
        <input type="number" min="0" step="0.5" value={filters.experienceMin} onChange={(e) => setFilters((p) => ({ ...p, experienceMin: e.target.value }))} placeholder="Min exp" />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </section>

      <details className="candidates-directory__advanced" open={showAdvancedFilters} onToggle={(event) => setShowAdvancedFilters(event.currentTarget.open)}>
        <summary>Advanced technical filters</summary>
        <div className="candidates-directory__advanced-grid">
          <label><span>Max experience</span><input type="number" min="0" step="0.5" value={filters.experienceMax} onChange={(e) => setFilters((p) => ({ ...p, experienceMax: e.target.value }))} /></label>
          <label><span>Max score</span><input type="number" min="0" max="10" step="0.1" value={filters.scoreMax} onChange={(e) => setFilters((p) => ({ ...p, scoreMax: e.target.value }))} /></label>
          <label><span>Tags</span><input value={filters.tags} onChange={(e) => setFilters((p) => ({ ...p, tags: e.target.value }))} placeholder="frontend, leadership" /></label>
          <label><span>Analysis ID</span><input value={filters.sourceAnalysisId} onChange={(e) => setFilters((p) => ({ ...p, sourceAnalysisId: e.target.value }))} placeholder="parse_123" /></label>
        </div>
      </details>

      <section className="candidates-directory__bulk" aria-label="Bulk shortlist actions">
        <label>
          <span>Shortlist</span>
          <select value={selectedShortlistId} onChange={(event) => setSelectedShortlistId(event.target.value)}>
            <option value="">Select shortlist</option>
            {shortlists.map((shortlist) => <option key={shortlist.id} value={shortlist.id}>{shortlist.name} ({shortlist.candidate_count || 0})</option>)}
          </select>
        </label>
        <button type="button" onClick={() => runBulkShortlistAction('add')}>Add selected</button>
        <button type="button" onClick={() => runBulkShortlistAction('remove')}>Remove selected</button>
      </section>

      {bulkStatus && <p className="candidates-directory__status">{bulkStatus}</p>}

      {viewState === 'loading' && <p className="candidates-directory__status">Loading candidates…</p>}
      {viewState === 'api-error' && (
        <div className="candidates-directory__error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={retryLoadCandidates}>Retry</button>
        </div>
      )}
      {viewState === 'no-candidates' && <p className="candidates-directory__status">No candidates available yet.</p>}
      {viewState === 'no-filter-results' && <p className="candidates-directory__status">No candidates matched the current filters.</p>}

      {(viewState === 'loaded' || viewState === 'no-filter-results') && (
        <>
          <section className="candidates-directory__table-wrap" aria-live="polite">
            <table className="candidates-directory__table">
              <thead>
                <tr><th></th><th>Name</th><th>Score</th><th>Experience</th><th>Skills</th><th>Tags</th><th>Job</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {visibleCandidates.map((candidate) => (
                  <tr key={candidate.resumeId}>
                    <td><input type="checkbox" checked={selectedResumeIds.includes(candidate.resumeId)} onChange={() => toggleSelectedCandidate(candidate.resumeId)} /></td>
                    <td><a href={`/candidates/${candidate.resumeId}`}>{candidate.name || 'Candidate'}</a></td>
                    <td>{getScoreLabel(candidate)}</td>
                    <td>{getExperienceLabel(candidate)}</td>
                    <td>{getSkillsLabel(candidate)}</td>
                    <td>{(candidate.tags || []).join(', ') || 'No tags'}</td>
                    <td>{candidate.associatedJob?.title || 'No linked job description'}</td>
                    <td>{formatDate(candidate.sourceUpdatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="candidates-directory__mobile-list">
            {visibleCandidates.map((candidate) => (
              <article key={candidate.resumeId} className="candidate-directory-card">
                <label><input type="checkbox" checked={selectedResumeIds.includes(candidate.resumeId)} onChange={() => toggleSelectedCandidate(candidate.resumeId)} />Select</label>
                <h2><a href={`/candidates/${candidate.resumeId}`}>{candidate.name || 'Candidate'}</a></h2>
                <p><strong>Score:</strong> {getScoreLabel(candidate)}</p>
                <p><strong>Experience:</strong> {getExperienceLabel(candidate)}</p>
                <p><strong>Skills:</strong> {getSkillsLabel(candidate)}</p>
                <p><strong>Tags:</strong> {(candidate.tags || []).join(', ') || 'No tags'}</p>
                <p><strong>Job:</strong> {candidate.associatedJob?.title || 'No linked job description'}</p>
              </article>
            ))}
          </section>

        </>
      )}
    </main>
  )
}
