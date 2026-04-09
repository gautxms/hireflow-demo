import { useEffect, useMemo, useState } from 'react'
import CandidateMatchScore from './CandidateMatchScore'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function resolveSelectedJobDescription(payload) {
  if (payload?.jobDescription && typeof payload.jobDescription === 'object') {
    return payload.jobDescription
  }

  try {
    const storedValue = localStorage.getItem('hireflow_selected_job_description')
    if (!storedValue) return null
    const parsed = JSON.parse(storedValue)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export default function CandidateResults({ candidates, onBack, isLoading = false, isSharedLoading = false, loadingProgress = 0 }) {
  const [sortBy, setSortBy] = useState('score') // 'score', 'name', 'fit'
  const [filterTier, setFilterTier] = useState('all') // 'all', 'top', 'strong', 'consider'
  const [matchCandidates, setMatchCandidates] = useState([])

  const rawCandidates = Array.isArray(candidates)
    ? candidates
    : Array.isArray(candidates?.candidates)
      ? candidates.candidates
      : []

  const displayCandidates = rawCandidates.length > 0 ? rawCandidates : null

  const hasRenderableCandidates = Array.isArray(displayCandidates)
    && displayCandidates.length > 0
    && displayCandidates.every((candidate) => candidate && (Array.isArray(candidate.skills) || typeof candidate.skills === 'string'))

  useEffect(() => {
    let cancelled = false

    async function fetchMatchScores() {
      if (!hasRenderableCandidates) {
        setMatchCandidates([])
        return
      }

      const selectedJobDescription = resolveSelectedJobDescription(candidates)
      const selectedJobDescriptionId = candidates?.jobDescriptionId || selectedJobDescription?.id || null

      if (!selectedJobDescriptionId && !selectedJobDescription) {
        setMatchCandidates(displayCandidates)
        return
      }

      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (!token) {
        setMatchCandidates(displayCandidates)
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/candidates/match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            jobDescriptionId: selectedJobDescriptionId,
            jobDescription: selectedJobDescription || undefined,
            candidates: displayCandidates,
          }),
        })

        if (!response.ok) {
          throw new Error(`Match API failed (${response.status})`)
        }

        const payload = await response.json()
        if (!cancelled) {
          setMatchCandidates(Array.isArray(payload.candidates) ? payload.candidates : displayCandidates)
        }
      } catch (error) {
        console.warn('[CandidateResults] Unable to fetch match scores:', error)
        if (!cancelled) {
          setMatchCandidates(displayCandidates)
        }
      }
    }

    fetchMatchScores()

    return () => {
      cancelled = true
    }
  }, [candidates, displayCandidates, hasRenderableCandidates])

  const filtered = useMemo(() => {
    if (!hasRenderableCandidates) {
      return []
    }

    const sourceCandidates = matchCandidates.length > 0 ? matchCandidates : displayCandidates
    const nextCandidates = filterTier === 'all'
      ? [...sourceCandidates]
      : sourceCandidates.filter((candidate) => candidate.tier === filterTier)

    if (sortBy === 'name') {
      return nextCandidates.sort((a, b) => a.name.localeCompare(b.name))
    }

    if (sortBy === 'fit') {
      const fitOrder = { 'Excellent fit': 0, Excellent: 1, 'Good fit': 2, Strong: 3, 'Potential fit': 4, Good: 5, Consider: 6, 'Low fit': 7 }
      return nextCandidates.sort((a, b) => (fitOrder[a.matchScore?.fit || a.fit] || 8) - (fitOrder[b.matchScore?.fit || b.fit] || 8))
    }

    return nextCandidates.sort((a, b) => {
      const scoreA = Number(a.matchScore?.score ?? a.score ?? 0)
      const scoreB = Number(b.matchScore?.score ?? b.score ?? 0)
      return scoreB - scoreA
    })
  }, [displayCandidates, filterTier, hasRenderableCandidates, matchCandidates, sortBy])

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
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.75rem', fontFamily: 'var(--font-display)' }}>
            Parsing in background
          </h1>
          <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
            We are processing resumes. This can take 1-5 minutes.
          </p>
          <p style={{ color: 'var(--accent)' }}>Progress: {Math.max(0, Math.min(100, Number(loadingProgress || 0)))}%</p>
        </div>
      </div>
    )
  }

  if (!hasRenderableCandidates) {
    return (
      <div className="candidate-results-page" style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
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
            Candidate Ranking
          </h1>
          <p style={{ color: 'var(--muted)' }}>Please upload resumes before viewing analysis.</p>
        </div>
      </div>
    )
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
          Candidate Ranking
        </h1>
        <p style={{ color: 'var(--muted)' }}>
          {filtered.length} candidates analyzed and ranked by fit
        </p>
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
          </select>
        </div>

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
          </select>
        </div>
      </div>

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
                <td data-label="Fit">{candidate.matchScore?.fit || candidate.fit}</td>
                <td data-label="Score">{candidate.matchScore?.score ?? candidate.score}</td>
                <td data-label="Top skills">{Array.isArray(candidate.skills) ? candidate.skills.slice(0, 3).join(', ') : String(candidate.skills || 'N/A')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Candidates List */}
      <div className="candidate-results-list" style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        {filtered.map(candidate => {
          const candidateSkills = Array.isArray(candidate.skills)
            ? candidate.skills
            : String(candidate.skills || '')
              .split(',')
              .map((skill) => skill.trim())
              .filter(Boolean)
          const candidatePros = Array.isArray(candidate.pros) ? candidate.pros : []
          const candidateCons = Array.isArray(candidate.cons) ? candidate.cons : []
          const tier = getTierBadge(candidate.tier)
          const displayScore = Number(candidate.matchScore?.score ?? candidate.score ?? 0)
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

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '100px',
                    height: '100px',
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${getScoreColor(displayScore)} 0%, transparent 70%)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `3px solid ${getScoreColor(displayScore)}`
                  }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '2rem', fontWeight: 'bold', color: getScoreColor(displayScore) }}>
                        {displayScore}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>score</div>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    background: tier.bg,
                    color: tier.color,
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    fontSize: '0.9rem'
                  }}>
                    {tier.label}
                  </div>
                </div>
              </div>

              <CandidateMatchScore matchScore={candidate.matchScore} />

              {/* Skills */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem' }}>Skills</h4>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {candidateSkills.map((skill, i) => (
                    <span
                      key={i}
                      style={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        padding: '0.4rem 0.8rem',
                        borderRadius: '4px',
                        fontSize: '0.85rem'
                      }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Pros & Cons */}
              <div className="candidate-pros-cons" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div>
                  <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--accent-2)' }}>
                    ✓ Strengths
                  </h4>
                  <ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>
                    {candidatePros.map((pro, i) => (
                      <li key={i}>{pro}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: '#f59e0b' }}>
                    ⚠ Considerations
                  </h4>
                  <ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>
                    {candidateCons.map((con, i) => (
                      <li key={i}>{con}</li>
                    ))}
                  </ul>
                </div>
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
