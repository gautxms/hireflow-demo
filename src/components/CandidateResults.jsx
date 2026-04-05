import { useEffect, useMemo, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const PAGE_SIZE = 25

function parseExperienceToYears(experience) {
  if (!experience) return 0
  const match = String(experience).match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function getExperienceLevel(candidate) {
  const years = parseExperienceToYears(candidate.experience)
  if (years >= 8) return 'lead'
  if (years >= 5) return 'senior'
  if (years >= 2) return 'mid'
  return 'junior'
}

function getSeniorityRank(candidate) {
  const level = getExperienceLevel(candidate)
  const order = { junior: 1, mid: 2, senior: 3, lead: 4 }
  return order[level] || 0
}

function normalizeCandidate(candidate = {}) {
  return {
    id: candidate.id || crypto.randomUUID(),
    name: candidate.name || 'Unknown Candidate',
    email: candidate.email || '',
    score: Number(candidate.score || 0),
    summary: candidate.summary || '',
    skills: Array.isArray(candidate.skills) ? candidate.skills : [],
    pros: Array.isArray(candidate.pros) ? candidate.pros : Array.isArray(candidate.strengths) ? candidate.strengths : [],
    cons: Array.isArray(candidate.cons) ? candidate.cons : [],
    location: candidate.location || 'Unknown',
    experience: candidate.experience || '0 years',
    position: candidate.position || '',
    education: candidate.education || '',
    fit: candidate.fit || '',
    tier: candidate.tier || 'consider',
  }
}

function sortCandidates(candidates, sortBy) {
  const sorted = [...candidates]

  sorted.sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'location') return a.location.localeCompare(b.location)
    if (sortBy === 'seniority') return getSeniorityRank(b) - getSeniorityRank(a)
    return b.score - a.score
  })

  return sorted
}

export default function CandidateResults({
  candidates,
  onBack,
  isLoading = false,
  loadingProgress = 0,
  shareToken = '',
}) {
  const [sortBy, setSortBy] = useState('score')
  const [scoreMin, setScoreMin] = useState('')
  const [scoreMax, setScoreMax] = useState('')
  const [locationFilter, setLocationFilter] = useState('all')
  const [levelFilter, setLevelFilter] = useState('all')
  const [viewMode, setViewMode] = useState('pagination')
  const [page, setPage] = useState(1)
  const [infiniteCount, setInfiniteCount] = useState(PAGE_SIZE)
  const [isExporting, setIsExporting] = useState(false)
  const [shareMessage, setShareMessage] = useState('')
  const [sharedCandidates, setSharedCandidates] = useState([])
  const [isSharedLoading, setIsSharedLoading] = useState(false)
  const [shareError, setShareError] = useState('')
  const [sharedExpiresAt, setSharedExpiresAt] = useState(null)

  useEffect(() => {
    if (!shareToken) {
      return
    }

    const controller = new AbortController()

    async function loadSharedResults() {
      try {
        setIsSharedLoading(true)
        setShareError('')

        const response = await fetch(`${API_BASE_URL}/api/results/shared/${shareToken}`, {
          method: 'GET',
          signal: controller.signal,
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload.error || 'Unable to load shared results')
        }

        const payload = await response.json()
        setSharedCandidates(Array.isArray(payload.candidates) ? payload.candidates.map(normalizeCandidate) : [])
        setSharedExpiresAt(payload.expiresAt || null)
      } catch (error) {
        if (error.name !== 'AbortError') {
          setShareError(error.message || 'Unable to load shared results')
        }
      } finally {
        setIsSharedLoading(false)
      }
    }

    void loadSharedResults()

    return () => controller.abort()
  }, [shareToken])

  const readOnly = Boolean(shareToken)
  const sourceCandidates = readOnly ? sharedCandidates : (Array.isArray(candidates) ? candidates : [])
  const displayCandidates = sourceCandidates.map(normalizeCandidate)

  const filtered = useMemo(() => {
    const min = scoreMin === '' ? null : Number(scoreMin)
    const max = scoreMax === '' ? null : Number(scoreMax)

    return sortCandidates(
      displayCandidates.filter((candidate) => {
        if (min !== null && candidate.score < min) return false
        if (max !== null && candidate.score > max) return false
        if (locationFilter !== 'all' && candidate.location.toLowerCase() !== locationFilter.toLowerCase()) return false
        if (levelFilter !== 'all' && getExperienceLevel(candidate) !== levelFilter) return false
        return true
      }),
      sortBy,
    )
  }, [displayCandidates, levelFilter, locationFilter, scoreMax, scoreMin, sortBy])

  useEffect(() => {
    setPage(1)
    setInfiniteCount(PAGE_SIZE)
  }, [sortBy, scoreMin, scoreMax, locationFilter, levelFilter, viewMode, shareToken])

  useEffect(() => {
    if (viewMode !== 'infinite') {
      return
    }

    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
        setInfiniteCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length))
      }
    }

    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [filtered.length, viewMode])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginatedCandidates = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const infiniteCandidates = filtered.slice(0, infiniteCount)
  const visibleCandidates = viewMode === 'infinite' ? infiniteCandidates : paginatedCandidates

  const allLocations = useMemo(() => {
    const locations = new Set(displayCandidates.map((candidate) => candidate.location || 'Unknown'))
    return ['all', ...Array.from(locations).sort((a, b) => a.localeCompare(b))]
  }, [displayCandidates])

  const handleExportCsv = async () => {
    if (readOnly) {
      return
    }

    try {
      setIsExporting(true)
      setShareMessage('')

      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (!token) {
        throw new Error('Authentication required before export')
      }

      const response = await fetch(`${API_BASE_URL}/api/results/export/csv`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          candidates: filtered,
          sortBy,
          sortOrder: 'desc',
          filters: {
            scoreMin,
            scoreMax,
            location: locationFilter,
            level: levelFilter,
          },
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to export CSV')
      }

      const csvBlob = await response.blob()
      const url = URL.createObjectURL(csvBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `candidate-results-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      setShareMessage('CSV exported successfully.')
    } catch (error) {
      setShareMessage(error.message || 'Unable to export CSV')
    } finally {
      setIsExporting(false)
    }
  }

  const handleCreateShareLink = async () => {
    if (readOnly) {
      return
    }

    try {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (!token) {
        throw new Error('Authentication required before sharing')
      }

      const response = await fetch(`${API_BASE_URL}/api/results/share`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ candidates: filtered }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to create share link')
      }

      const payload = await response.json()
      const fullLink = `${window.location.origin}${payload.sharePath}`

      await navigator.clipboard.writeText(fullLink)
      setShareMessage(`Share link copied. Expires on ${new Date(payload.expiresAt).toLocaleDateString()}.`)
    } catch (error) {
      setShareMessage(error.message || 'Unable to create share link')
    }
  }

  const hasRenderableCandidates = displayCandidates.length > 0

  if (isLoading || isSharedLoading) {
    return (
      <div className="candidate-results-page" style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <button
            className="touch-target"
            onClick={onBack}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--accent)',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
            }}
          >
            ← Upload New Resumes
          </button>
          {!readOnly && onBack && (
            <button
              onClick={onBack}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--accent)',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                cursor: 'pointer',
                marginBottom: '1.5rem',
                fontSize: '0.9rem',
              }}
            >
              ← Upload New Resumes
            </button>
          )}
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.75rem', fontFamily: 'var(--font-display)' }}>
            {readOnly ? 'Loading shared results' : 'Parsing in background'}
          </h1>
          {!readOnly && <p style={{ color: 'var(--accent)' }}>Progress: {Math.max(0, Math.min(100, Number(loadingProgress || 0)))}%</p>}
        </div>
      </div>
    )
  }

  if (shareError) {
    return (
      <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.75rem', fontFamily: 'var(--font-display)' }}>Shared link unavailable</h1>
          <p style={{ color: '#ef4444' }}>{shareError}</p>
        </div>
      </div>
    )
  }

  if (!hasRenderableCandidates) {
    return (
      <div className="candidate-results-page" style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          {!readOnly && onBack && (
            <button
              onClick={onBack}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--accent)',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                cursor: 'pointer',
                marginBottom: '1rem',
                fontSize: '0.9rem',
              }}
            >
              ← Upload New Resumes
            </button>
          )}
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>Candidate Ranking</h1>
          <p style={{ color: 'var(--muted)' }}>No candidates available.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem' }}>
        {!readOnly && onBack && (
          <button
            className="touch-target"
            onClick={onBack}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--accent)',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '1rem',
              fontSize: '0.9rem',
            }}
          >
            ← Upload New Resumes
          </button>
        )}

  let filtered = displayCandidates
  if (filterTier !== 'all') {
    filtered = filtered.filter(c => c.tier === filterTier)
  }

  if (sortBy === 'name') {
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  } else if (sortBy === 'fit') {
    const fitOrder = { 'Excellent': 0, 'Strong': 1, 'Good': 2, 'Consider': 3 }
    filtered = [...filtered].sort((a, b) => (fitOrder[a.fit] || 4) - (fitOrder[b.fit] || 4))
  } else {
    filtered = [...filtered].sort((a, b) => b.score - a.score)
  }

  const getScoreColor = (score) => {
    if (score >= 90) return 'var(--accent-2)' // cyan
    if (score >= 80) return 'var(--accent)' // lime
    if (score >= 70) return '#f59e0b' // orange
    return '#ef4444' // red
  }

  const getTierBadge = (tier) => {
    const styles = {
      top: { bg: 'rgba(90,255,184,0.15)', color: 'var(--accent-2)', label: '⭐ TOP' },
      strong: { bg: 'rgba(232,255,90,0.15)', color: 'var(--accent)', label: '✓ STRONG' },
      consider: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: '→ CONSIDER' }
    }
    const style = styles[tier] || styles.consider
    return { bg: style.bg, color: style.color, label: style.label }
  }

  return (
    <div className="candidate-results-page" style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      {/* Header */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem' }}>
        <button
          className="touch-target"
          onClick={onBack}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--accent)',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.9rem'
          }}
        >
          ← Upload New Resumes
        </button>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>
          Candidate Ranking {readOnly ? '(Shared Read-Only)' : ''}
        </h1>
        <p style={{ color: 'var(--muted)' }}>
          {filtered.length} matching candidates • {displayCandidates.length} total
        </p>
        {readOnly && sharedExpiresAt && (
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Shared link expires on {new Date(sharedExpiresAt).toLocaleDateString()}.
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="candidate-results-controls" style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Sort By</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="touch-target"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <option value="score">Score (High to Low)</option>
            <option value="name">Name (A-Z)</option>
            <option value="fit">Fit Quality</option>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1rem' }}>
        <aside style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem', height: 'fit-content' }}>
          <h3 style={{ marginBottom: '1rem' }}>Filters</h3>

          <label style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Min Score</label>
          <input value={scoreMin} onChange={(event) => setScoreMin(event.target.value)} type="number" min="0" max="100" style={{ width: '100%', marginBottom: '0.75rem' }} />

          <label style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Max Score</label>
          <input value={scoreMax} onChange={(event) => setScoreMax(event.target.value)} type="number" min="0" max="100" style={{ width: '100%', marginBottom: '0.75rem' }} />

          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block' }}>Location</label>
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} style={{ width: '100%', marginBottom: '0.75rem' }}>
            {allLocations.map((location) => (
              <option key={location} value={location}>{location === 'all' ? 'All locations' : location}</option>
            ))}
          </select>

        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Filter</label>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            className="touch-target"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <option value="all">All Candidates</option>
            <option value="top">Top Tier Only</option>
            <option value="strong">Strong & Above</option>
            <option value="consider">All Including Consider</option>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block' }}>Experience Level</label>
          <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)} style={{ width: '100%' }}>
            <option value="all">All levels</option>
            <option value="junior">Junior</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="lead">Lead</option>
          </select>
        </aside>

      <div className="candidate-results-table-wrapper">
        <table className="candidate-results-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Fit</th>
              <th>Score</th>
              <th>Top skills</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((candidate) => (
              <tr key={`summary-${candidate.id}`}>
                <td data-label="Candidate">{candidate.name}</td>
                <td data-label="Fit">{candidate.fit}</td>
                <td data-label="Score">{candidate.score}</td>
                <td data-label="Top skills">{candidate.skills.slice(0, 3).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Candidates List */}
      <div className="candidate-results-list" style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        {filtered.map(candidate => {
          const tier = getTierBadge(candidate.tier)
          return (
            <div
              className="candidate-result-card"
              key={candidate.id}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '2rem',
                transition: 'all 0.3s'
              }}
            >
              {/* Top Section */}
              <div className="candidate-top-section" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2rem', marginBottom: '1.5rem', alignItems: 'start' }}>
                <div>
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                    {candidate.name}
                  </h3>
                  <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>
                    {candidate.position} • {candidate.experience}
                  </p>
                  <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                    {candidate.education}
                  </p>
                </div>
        <section>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'end' }}>
            <div>
              <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block' }}>Sort By</label>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="score">Score (desc)</option>
                <option value="seniority">Seniority</option>
                <option value="location">Location</option>
                <option value="name">Name</option>
              </select>
            </div>

            <div>
              <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block' }}>View Mode</label>
              <select value={viewMode} onChange={(event) => setViewMode(event.target.value)}>
                <option value="pagination">Pagination</option>
                <option value="infinite">Infinite scroll</option>
              </select>
            </div>

            {!readOnly && (
              <>
                <button onClick={handleExportCsv} disabled={isExporting} style={{ padding: '0.5rem 0.75rem' }}>
                  {isExporting ? 'Exporting…' : 'Export CSV'}
                </button>
                <button onClick={handleCreateShareLink} style={{ padding: '0.5rem 0.75rem' }}>Share Results</button>
              </>
            )}
          </div>

          {shareMessage && (
            <p style={{ color: shareMessage.toLowerCase().includes('unable') || shareMessage.toLowerCase().includes('failed') ? '#ef4444' : 'var(--accent-2)', marginBottom: '1rem' }}>
              {shareMessage}
            </p>
          )}

          <div style={{ display: 'grid', gap: '1rem' }}>
            {visibleCandidates.map((candidate) => (
              <div key={candidate.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ marginBottom: '0.25rem' }}>{candidate.name}</h3>
                    <p style={{ color: 'var(--muted)', marginBottom: '0.25rem' }}>{candidate.position} • {candidate.experience} • {candidate.location}</p>
                    <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{candidate.email || 'No email available'}</p>
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--accent)' }}>{candidate.score}</div>
                </div>

                {candidate.summary && <p style={{ marginTop: '0.75rem', color: 'var(--muted)' }}>{candidate.summary}</p>}

                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {candidate.skills.map((skill, idx) => (
                    <span key={`${candidate.id}-${skill}-${idx}`} style={{ border: '1px solid var(--border)', borderRadius: '20px', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>
                      {skill}
                    </span>
                  ))}
                </div>

              {/* Pros & Cons */}
              <div className="candidate-pros-cons" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div>
                  <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--accent-2)' }}>
                    ✓ Strengths
                  </h4>
                  <ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>
                    {candidate.pros.map((pro, i) => (
                      <li key={i}>{pro}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: '#f59e0b' }}>
                    ⚠ Considerations
                  </h4>
                  <ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>
                    {candidate.cons.map((con, i) => (
                      <li key={i}>{con}</li>
                    ))}
                  </ul>
                </div>
                {candidate.pros.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <strong style={{ fontSize: '0.9rem' }}>Strengths:</strong>
                    <ul style={{ margin: '0.4rem 0 0 1.2rem', color: 'var(--muted)' }}>
                      {candidate.pros.map((strength, index) => <li key={`${candidate.id}-pro-${index}`}>{strength}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

              {/* CTA */}
              <div className="candidate-cta-row" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
                <button style={{
                  minHeight: 44,
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  border: 'none',
                  padding: '0.6rem 1.5rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}>
                  Schedule Interview
                </button>
                <button style={{
                  minHeight: 44,
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  padding: '0.6rem 1.5rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}>
                  View Full Profile
                </button>
              </div>
          {viewMode === 'pagination' && (
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1}>Previous</button>
              <span style={{ color: 'var(--muted)' }}>Page {page} / {totalPages}</span>
              <button onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages}>Next</button>
            </div>
          )}

          {viewMode === 'infinite' && infiniteCount < filtered.length && (
            <button onClick={() => setInfiniteCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length))} style={{ marginTop: '1rem' }}>
              Load more
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
