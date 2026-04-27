import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
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

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

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
      if (String(value || '').trim()) {
        params.set(key, String(value).trim())
      }
    })

    return params.toString()
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
  }, [queryString])

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

  const toggleSelectedCandidate = (resumeId) => {
    setSelectedResumeIds((current) => (
      current.includes(resumeId)
        ? current.filter((id) => id !== resumeId)
        : [...current, resumeId]
    ))
  }

  const runBulkShortlistAction = async (mode) => {
    if (!selectedShortlistId) {
      setBulkStatus('Select a shortlist first.')
      return
    }
    if (selectedResumeIds.length === 0) {
      setBulkStatus('Select at least one candidate to run a bulk action.')
      return
    }

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
      if (!response.ok) {
        throw new Error(payload.error || 'Bulk shortlist action failed')
      }

      const summary = payload?.summary || {}
      if (mode === 'add') {
        setBulkStatus(`Bulk add complete: ${summary.added || 0} added, ${summary.updated || 0} updated, ${summary.failed || 0} failed.`)
      } else {
        setBulkStatus(`Bulk remove complete: ${summary.removed || 0} removed, ${summary.notPresent || 0} not present.`)
      }
      setSelectedResumeIds([])
    } catch (bulkError) {
      setBulkStatus(bulkError.message || 'Bulk shortlist action failed')
    }
  }

  return (
    <main className="candidates-directory">
      <header className="candidates-directory__header">
        <h1>Candidates</h1>
        <p>Filter across skills, experience, score, tags, and source provenance.</p>
      </header>

      <section className="candidates-directory__filters" aria-label="Candidate filters">
        {Object.entries(emptyFilters).map(([key]) => (
          <label key={key} className="candidates-directory__filter-field">
            <span>{key}</span>
            <input
              value={filters[key]}
              onChange={(event) => setFilters((prev) => ({ ...prev, [key]: event.target.value }))}
              placeholder={`Filter by ${key}`}
            />
          </label>
        ))}
      </section>

      <section className="candidates-directory__filters" aria-label="Bulk shortlist actions">
        <label className="candidates-directory__filter-field">
          <span>shortlist</span>
          <select
            value={selectedShortlistId}
            onChange={(event) => setSelectedShortlistId(event.target.value)}
          >
            <option value="">Select shortlist</option>
            {shortlists.map((shortlist) => (
              <option key={shortlist.id} value={shortlist.id}>
                {shortlist.name} ({shortlist.candidate_count || 0})
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => runBulkShortlistAction('add')}>
          Add selected to shortlist
        </button>
        <button type="button" onClick={() => runBulkShortlistAction('remove')}>
          Remove selected from shortlist
        </button>
      </section>

      {bulkStatus && <p className="candidates-directory__status">{bulkStatus}</p>}

      {error && <p className="candidates-directory__error">{error}</p>}
      {isLoading && <p className="candidates-directory__status">Loading candidates…</p>}
      {!isLoading && !error && candidates.length === 0 && <p className="candidates-directory__status">No candidates matched the current filters.</p>}

      <section className="candidates-directory__grid" aria-live="polite">
        {candidates.map((candidate) => (
          <article key={candidate.resumeId} className="candidate-directory-card">
            <label>
              <input
                type="checkbox"
                checked={selectedResumeIds.includes(candidate.resumeId)}
                onChange={() => toggleSelectedCandidate(candidate.resumeId)}
              />
              Select
            </label>
            <h2>{candidate.name || 'Candidate'}</h2>
            <p><strong>Score:</strong> {candidate.profileScore ?? 'N/A'}</p>
            <p><strong>Experience:</strong> {candidate.yearsExperience ?? 'N/A'} years</p>
            <p><strong>Skills:</strong> {(candidate.skills || []).slice(0, 6).join(', ') || 'None listed'}</p>
            <p><strong>Tags:</strong> {(candidate.tags || []).join(', ') || 'No tags'}</p>
            <p><strong>Analysis:</strong> {formatDate(candidate.sourceUpdatedAt)}</p>
            <p><strong>Job:</strong> {candidate.associatedJob?.title || 'No linked job description'}</p>
            <a href={`/candidates/${candidate.resumeId}`}>View profile</a>
          </article>
        ))}
      </section>
    </main>
  )
}
