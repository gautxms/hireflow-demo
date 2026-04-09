import { useCallback, useEffect, useMemo, useState } from 'react'
import ShortlistManager from './ShortlistManager'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function CandidateResults({ candidates, onBack, isLoading = false, isSharedLoading = false, loadingProgress = 0 }) {
  const [sortBy, setSortBy] = useState('score')
  const [filterTier, setFilterTier] = useState('all')
  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [shortlistDetails, setShortlistDetails] = useState(null)
  const [shortlistSort, setShortlistSort] = useState('rating_desc')
  const [shortlistLoading, setShortlistLoading] = useState(false)
  const [shortlistError, setShortlistError] = useState('')

  const rawCandidates = Array.isArray(candidates)
    ? candidates
    : Array.isArray(candidates?.candidates)
      ? candidates.candidates
      : []

  const displayCandidates = rawCandidates.length > 0 ? rawCandidates : null

  const hasRenderableCandidates = Array.isArray(displayCandidates)
    && displayCandidates.length > 0
    && displayCandidates.every((candidate) => candidate && (Array.isArray(candidate.skills) || typeof candidate.skills === 'string'))

  const authHeaders = () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  const loadShortlists = useCallback(async () => {
    try {
      setShortlistLoading(true)
      const response = await fetch('/api/shortlists', {
        method: 'GET',
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load shortlists')
      }

      const incoming = Array.isArray(payload.shortlists) ? payload.shortlists : []
      setShortlists(incoming)

      if (!selectedShortlistId && incoming[0]?.id) {
        setSelectedShortlistId(incoming[0].id)
      }
    } catch (error) {
      setShortlistError(error.message || 'Unable to load shortlists')
    } finally {
      setShortlistLoading(false)
    }
  }, [selectedShortlistId])

  const loadShortlistDetails = useCallback(async (shortlistId, sortKey = shortlistSort) => {
    if (!shortlistId) {
      setShortlistDetails(null)
      return
    }

    const sortMap = {
      rating_desc: 'sortBy=rating&sortOrder=desc',
      rating_asc: 'sortBy=rating&sortOrder=asc',
      added_desc: 'sortBy=added_at&sortOrder=desc',
      added_asc: 'sortBy=added_at&sortOrder=asc',
    }

    try {
      setShortlistLoading(true)
      const query = sortMap[sortKey] || sortMap.rating_desc
      const response = await fetch(`/api/shortlists/${shortlistId}?${query}`, {
        method: 'GET',
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load shortlist details')
      }

      setShortlistDetails(payload)
    } catch (error) {
      setShortlistError(error.message || 'Unable to load shortlist details')
    } finally {
      setShortlistLoading(false)
    }
  }, [shortlistSort])

  const createShortlist = async ({ name, description }) => {
    try {
      setShortlistLoading(true)
      setShortlistError('')
      const response = await fetch('/api/shortlists', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, description }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create shortlist')
      }

      await loadShortlists()
      const newId = payload.shortlist?.id
      if (newId) {
        setSelectedShortlistId(newId)
        await loadShortlistDetails(newId)
      }
    } catch (error) {
      setShortlistError(error.message || 'Unable to create shortlist')
    } finally {
      setShortlistLoading(false)
    }
  }

  const addCandidateToShortlist = async (candidate) => {
    try {
      if (!selectedShortlistId) {
        throw new Error('Create or select a shortlist first')
      }

      const ratingGuess = Math.max(1, Math.min(5, Math.round(Number(candidate.score || 0) / 20)))

      const response = await fetch(`/api/shortlists/${selectedShortlistId}/candidates`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          resumeId: candidate.id,
          notes: `Added from candidate ranking: ${candidate.name || 'Unknown Candidate'}`,
          rating: ratingGuess,
        }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to add candidate to shortlist')
      }

      await Promise.all([loadShortlists(), loadShortlistDetails(selectedShortlistId)])
    } catch (error) {
      setShortlistError(error.message || 'Unable to add candidate to shortlist')
    }
  }

  useEffect(() => {
    loadShortlists()
  }, [loadShortlists])

  useEffect(() => {
    if (!selectedShortlistId) {
      return
    }

    loadShortlistDetails(selectedShortlistId)
  }, [loadShortlistDetails, selectedShortlistId])

  const filtered = useMemo(() => {
    if (!hasRenderableCandidates) {
      return []
    }

    const nextCandidates = filterTier === 'all'
      ? [...displayCandidates]
      : displayCandidates.filter((candidate) => candidate.tier === filterTier)

    if (sortBy === 'name') {
      return nextCandidates.sort((a, b) => a.name.localeCompare(b.name))
    }

    if (sortBy === 'fit') {
      const fitOrder = { Excellent: 0, Strong: 1, Good: 2, Consider: 3 }
      return nextCandidates.sort((a, b) => (fitOrder[a.fit] || 4) - (fitOrder[b.fit] || 4))
    }

    return nextCandidates.sort((a, b) => b.score - a.score)
  }, [displayCandidates, filterTier, hasRenderableCandidates, sortBy])

  if (isLoading || isSharedLoading) {
    return (
      <div className="candidate-results-page" style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <button className="touch-target" onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1.5rem', fontSize: '0.9rem' }}>← Upload New Resumes</button>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.75rem', fontFamily: 'var(--font-display)' }}>Parsing in background</h1>
          <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>We are processing resumes. This can take 1-5 minutes.</p>
          <p style={{ color: 'var(--accent)' }}>Progress: {Math.max(0, Math.min(100, Number(loadingProgress || 0)))}%</p>
        </div>
      </div>
    )
  }

  if (!hasRenderableCandidates) {
    return (
      <div className="candidate-results-page" style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <button className="touch-target" onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>← Upload New Resumes</button>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>Candidate Ranking</h1>
          <p style={{ color: 'var(--muted)' }}>Please upload resumes before viewing analysis.</p>
        </div>
      </div>
    )
  }

  const getScoreColor = (score) => {
    if (score >= 90) return 'var(--accent-2)'
    if (score >= 80) return 'var(--accent)'
    if (score >= 70) return '#f59e0b'
    return '#ef4444'
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
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem' }}>
        <button className="touch-target" onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>← Upload New Resumes</button>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>Candidate Ranking</h1>
        <p style={{ color: 'var(--muted)' }}>{filtered.length} candidates analyzed and ranked by fit</p>
      </div>

      <ShortlistManager
        shortlists={shortlists}
        selectedShortlistId={selectedShortlistId}
        shortlistDetails={shortlistDetails}
        onSelectShortlist={setSelectedShortlistId}
        onCreateShortlist={createShortlist}
        onChangeSort={async (sortOption) => {
          setShortlistSort(sortOption)
          await loadShortlistDetails(selectedShortlistId, sortOption)
        }}
        onRefresh={async () => {
          await loadShortlists()
          await loadShortlistDetails(selectedShortlistId)
        }}
        loading={shortlistLoading}
        error={shortlistError}
      />

      <div className="candidate-results-controls" style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Sort By</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="touch-target" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}>
            <option value="score">Score (High to Low)</option>
            <option value="name">Name (A-Z)</option>
            <option value="fit">Fit Quality</option>
          </select>
        </div>

        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Filter</label>
          <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)} className="touch-target" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}>
            <option value="all">All Candidates</option>
            <option value="top">Top Tier Only</option>
            <option value="strong">Strong & Above</option>
            <option value="consider">All Including Consider</option>
          </select>
        </div>
      </div>

      <div className="candidate-results-table-wrapper">
        <table className="candidate-results-table">
          <thead>
            <tr><th>Candidate</th><th>Fit</th><th>Score</th><th>Top skills</th></tr>
          </thead>
          <tbody>
            {filtered.map((candidate) => (
              <tr key={`summary-${candidate.id}`}>
                <td data-label="Candidate">{candidate.name}</td>
                <td data-label="Fit">{candidate.fit}</td>
                <td data-label="Score">{candidate.score}</td>
                <td data-label="Top skills">{Array.isArray(candidate.skills) ? candidate.skills.slice(0, 3).join(', ') : String(candidate.skills || 'N/A')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="candidate-results-list" style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        {filtered.map((candidate) => {
          const candidateSkills = Array.isArray(candidate.skills) ? candidate.skills : String(candidate.skills || '').split(',').map((skill) => skill.trim()).filter(Boolean)
          const candidatePros = Array.isArray(candidate.pros) ? candidate.pros : []
          const candidateCons = Array.isArray(candidate.cons) ? candidate.cons : []
          const tier = getTierBadge(candidate.tier)
          return (
            <div className="candidate-result-card" key={candidate.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', transition: 'all 0.3s' }}>
              <div className="candidate-top-section" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2rem', marginBottom: '1.5rem', alignItems: 'start' }}>
                <div>
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{candidate.name}</h3>
                  <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>{candidate.position} • {candidate.experience}</p>
                  <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{candidate.education}</p>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ width: '100px', height: '100px', borderRadius: '50%', background: `radial-gradient(circle, ${getScoreColor(candidate.score)} 0%, transparent 70%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${getScoreColor(candidate.score)}` }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '2rem', fontWeight: 'bold', color: getScoreColor(candidate.score) }}>{candidate.score}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>score</div>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ background: tier.bg, color: tier.color, padding: '0.75rem 1rem', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.9rem' }}>{tier.label}</div>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem' }}>Skills</h4>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {candidateSkills.map((skill, i) => (
                    <span key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.85rem' }}>{skill}</span>
                  ))}
                </div>
              </div>

              <div className="candidate-pros-cons" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div>
                  <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--accent-2)' }}>✓ Strengths</h4>
                  <ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>{candidatePros.map((pro, i) => <li key={i}>{pro}</li>)}</ul>
                </div>
                <div>
                  <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: '#f59e0b' }}>⚠ Considerations</h4>
                  <ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>{candidateCons.map((con, i) => <li key={i}>{con}</li>)}</ul>
                </div>
              </div>

              <div className="candidate-cta-row" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button style={{ minHeight: 44, background: 'var(--accent)', color: 'var(--ink)', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>Schedule Interview</button>
                <button style={{ minHeight: 44, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.6rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>View Full Profile</button>
                <button
                  onClick={() => addCandidateToShortlist(candidate)}
                  style={{ minHeight: 44, background: 'transparent', color: 'var(--accent-2)', border: '1px solid var(--accent-2)', padding: '0.6rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  Add to shortlist
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
