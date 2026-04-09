import { useMemo, useState } from 'react'
import CandidateFilters from './CandidateFilters'

function parseSkills(skills) {
  if (Array.isArray(skills)) {
    return skills.map((skill) => String(skill || '').trim()).filter(Boolean)
  }

  return String(skills || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)
}

function parseYears(experience) {
  const match = String(experience || '').match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function parseUploadDate(candidate) {
  const value = candidate?.uploadDate || candidate?.uploadedAt || candidate?.created_at || candidate?.createdAt
  const timestamp = Date.parse(String(value || ''))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function filterAndSortCandidates(candidates, filters) {
  const {
    searchText = '',
    selectedSkills = [],
    expRange = { min: '', max: '' },
    matchRange = { min: '', max: '' },
    sortBy = 'match_score',
  } = filters || {}

  const query = searchText.trim().toLowerCase()
  const expMin = expRange?.min === '' ? null : Number(expRange?.min)
  const expMax = expRange?.max === '' ? null : Number(expRange?.max)
  const matchMin = matchRange?.min === '' ? null : Number(matchRange?.min)
  const matchMax = matchRange?.max === '' ? null : Number(matchRange?.max)

  const filtered = candidates.filter((candidate) => {
    if (query) {
      const searchable = `${candidate?.name || ''} ${candidate?.email || ''} ${candidate?.phone || ''}`.toLowerCase()
      if (!searchable.includes(query)) {
        return false
      }
    }

    const candidateSkills = parseSkills(candidate?.skills).map((skill) => skill.toLowerCase())
    if (selectedSkills.length > 0) {
      const hasAllSelectedSkills = selectedSkills.every((skill) => candidateSkills.includes(String(skill).toLowerCase()))
      if (!hasAllSelectedSkills) {
        return false
      }
    }

    const years = parseYears(candidate?.experience)
    if (expMin !== null && years < expMin) {
      return false
    }

    if (expMax !== null && years > expMax) {
      return false
    }

    const score = Number(candidate?.score || 0)
    if (matchMin !== null && score < matchMin) {
      return false
    }

    if (matchMax !== null && score > matchMax) {
      return false
    }

    return true
  })

  return [...filtered].sort((a, b) => {
    if (sortBy === 'name') {
      return String(a?.name || '').localeCompare(String(b?.name || ''))
    }

    if (sortBy === 'experience') {
      return parseYears(b?.experience) - parseYears(a?.experience)
    }

    if (sortBy === 'upload_date') {
      return parseUploadDate(b) - parseUploadDate(a)
    }

    return Number(b?.score || 0) - Number(a?.score || 0)
  })
}

export default function CandidateResults({ candidates, onBack, isLoading = false, isSharedLoading = false, loadingProgress = 0 }) {
  const [searchText, setSearchText] = useState('')
  const [selectedSkills, setSelectedSkills] = useState([])
  const [expRange, setExpRange] = useState({ min: '', max: '' })
  const [matchRange, setMatchRange] = useState({ min: '', max: '' })
  const [sortBy, setSortBy] = useState('match_score')
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

    return filterAndSortCandidates(displayCandidates, {
      searchText,
      selectedSkills,
      expRange,
      matchRange,
      sortBy,
    })
  }, [displayCandidates, expRange, hasRenderableCandidates, matchRange, searchText, selectedSkills, sortBy])

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

      <CandidateFilters
        candidates={displayCandidates}
        searchText={searchText}
        selectedSkills={selectedSkills}
        expRange={expRange}
        matchRange={matchRange}
        sortBy={sortBy}
        onSearch={setSearchText}
        onSkillsFilter={setSelectedSkills}
        onExperienceFilter={setExpRange}
        onMatchFilter={setMatchRange}
        onSort={setSortBy}
      />

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
              <div className="candidate-top-section" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2rem', marginBottom: '1.5rem', alignItems: 'start' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--text)' }}>
                    {candidate.name}
                  </h2>
                  <p style={{ color: 'var(--muted)', marginBottom: '0.25rem' }}>📧 {candidate.email || 'No email provided'}</p>
                  <p style={{ color: 'var(--muted)' }}>📍 {candidate.location || 'Unknown location'}</p>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '90px',
                    height: '90px',
                    borderRadius: '50%',
                    background: `conic-gradient(${getScoreColor(candidate.score)} ${candidate.score * 3.6}deg, rgba(255,255,255,0.1) 0deg)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '0.5rem',
                    position: 'relative'
                  }}>
                    <div style={{
                      width: '75px',
                      height: '75px',
                      borderRadius: '50%',
                      background: 'var(--card)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.5rem',
                      fontWeight: 'bold',
                      color: getScoreColor(candidate.score)
                    }}>
                      {candidate.score}
                    </div>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Match Score</p>
                </div>

                <div>
                  <div style={{
                    background: tier.bg,
                    color: tier.color,
                    padding: '0.5rem 1rem',
                    borderRadius: '20px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    marginBottom: '0.75rem'
                  }}>
                    {tier.label}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Fit: {candidate.fit || 'N/A'}</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Experience: {candidate.experience || 'N/A'}</p>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Summary</h3>
                <p style={{ color: 'var(--text)', lineHeight: '1.6' }}>{candidate.summary || 'No summary available'}</p>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>Top Skills</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {candidateSkills.map((skill, idx) => (
                    <span
                      key={idx}
                      style={{
                        background: 'rgba(90,255,184,0.1)',
                        color: 'var(--accent-2)',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '20px',
                        fontSize: '0.85rem',
                        border: '1px solid rgba(90,255,184,0.3)'
                      }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              <div className="candidate-evaluation-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ color: 'var(--accent-2)', fontSize: '1rem', marginBottom: '0.75rem' }}>✅ Strengths</h3>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text)' }}>
                    {candidatePros.length > 0
                      ? candidatePros.map((pro, idx) => (
                        <li key={idx} style={{ marginBottom: '0.5rem', lineHeight: '1.5' }}>{pro}</li>
                      ))
                      : <li style={{ marginBottom: '0.5rem', lineHeight: '1.5' }}>No strengths listed.</li>}
                  </ul>
                </div>

                <div>
                  <h3 style={{ color: '#f59e0b', fontSize: '1rem', marginBottom: '0.75rem' }}>⚠️ Considerations</h3>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text)' }}>
                    {candidateCons.length > 0
                      ? candidateCons.map((con, idx) => (
                        <li key={idx} style={{ marginBottom: '0.5rem', lineHeight: '1.5' }}>{con}</li>
                      ))
                      : <li style={{ marginBottom: '0.5rem', lineHeight: '1.5' }}>No concerns listed.</li>}
                  </ul>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
