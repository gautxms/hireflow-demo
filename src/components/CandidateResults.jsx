import { useMemo, useState } from 'react'
import BulkActions from './BulkActions'

export default function CandidateResults({ candidates, onBack, isLoading = false, isSharedLoading = false, loadingProgress = 0 }) {
  const [sortBy, setSortBy] = useState('score') // 'score', 'name', 'fit'
  const [filterTier, setFilterTier] = useState('all') // 'all', 'top', 'strong', 'consider'
  const [selectedIds, setSelectedIds] = useState([])
  const [deletedIds, setDeletedIds] = useState([])
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

  const rawCandidates = Array.isArray(candidates)
    ? candidates
    : Array.isArray(candidates?.candidates)
      ? candidates.candidates
      : []

  const displayCandidates = rawCandidates.length > 0 ? rawCandidates : null

  const hasRenderableCandidates = Array.isArray(displayCandidates)
    && displayCandidates.length > 0
    && displayCandidates.every((candidate) => candidate && (Array.isArray(candidate.skills) || typeof candidate.skills === 'string'))

  const candidateRows = useMemo(() => {
    if (!Array.isArray(displayCandidates)) {
      return []
    }

    return displayCandidates
      .map((candidate, index) => ({
        ...candidate,
        _bulkKey: String(candidate?.id ?? `${candidate?.name || 'candidate'}-${index}`)
      }))
      .filter((candidate) => !deletedIds.includes(candidate._bulkKey))
  }, [deletedIds, displayCandidates])

  const filtered = useMemo(() => {
    if (!hasRenderableCandidates) {
      return []
    }

    const nextCandidates = filterTier === 'all'
      ? [...candidateRows]
      : candidateRows.filter((candidate) => candidate.tier === filterTier)

    if (sortBy === 'name') {
      return nextCandidates.sort((a, b) => a.name.localeCompare(b.name))
    }

    if (sortBy === 'fit') {
      const fitOrder = { Excellent: 0, Strong: 1, Good: 2, Consider: 3 }
      return nextCandidates.sort((a, b) => (fitOrder[a.fit] || 4) - (fitOrder[b.fit] || 4))
    }

    return nextCandidates.sort((a, b) => b.score - a.score)
  }, [candidateRows, filterTier, hasRenderableCandidates, sortBy])

  const selectedCandidates = filtered.filter((candidate) => selectedIds.includes(candidate._bulkKey))
  const allFilteredSelected = filtered.length > 0 && filtered.every((candidate) => selectedIds.includes(candidate._bulkKey))

  const toggleCandidateSelection = (candidateKey) => {
    setSelectedIds((currentSelected) => (
      currentSelected.includes(candidateKey)
        ? currentSelected.filter((id) => id !== candidateKey)
        : [...currentSelected, candidateKey]
    ))
  }

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((currentSelected) => currentSelected.filter((id) => !filtered.some((candidate) => candidate._bulkKey === id)))
      return
    }

    setSelectedIds((currentSelected) => [
      ...new Set([...currentSelected, ...filtered.map((candidate) => candidate._bulkKey)])
    ])
  }

  const toCSVValue = (value) => {
    const stringValue = String(value ?? '')
    return `"${stringValue.replaceAll('"', '""')}"`
  }

  const exportCSV = (selected) => {
    const rows = selected.map((candidate) => [
      candidate.name,
      candidate.fit,
      candidate.score,
      Array.isArray(candidate.skills) ? candidate.skills.join('|') : candidate.skills
    ])

    const header = ['Name', 'Fit', 'Score', 'Skills']
    const csvContent = [header, ...rows].map((row) => row.map(toCSVValue).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `hireflow-candidates-${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const emailForm = (selected) => {
    const recipients = selected.map((candidate) => candidate.email).filter(Boolean)
    if (recipients.length === 0) {
      alert('No candidate emails found. Please add emails before exporting to email.')
      return
    }
    window.location.href = `mailto:${recipients.join(',')}?subject=HireFlow%20Feedback%20Form`
  }

  const addToShortlist = (selected) => {
    const names = selected.map((candidate) => candidate.name).join(', ')
    alert(`Added to shortlist: ${names}`)
  }

  const sendFeedbackForm = (selected) => {
    alert(`Feedback form sent to ${selected.length} candidate(s).`)
    emailForm(selected)
  }

  const deleteSelected = (selected) => {
    const deleteKeys = selected.map((candidate) => candidate._bulkKey)
    setDeletedIds((current) => [...new Set([...current, ...deleteKeys])])
    setSelectedIds((current) => current.filter((id) => !deleteKeys.includes(id)))
  }
    return filterAndSortCandidates(displayCandidates, {
      searchText,
      selectedSkills,
      expRange,
      matchRange,
      sortBy,
    })
  }, [displayCandidates, expRange, hasRenderableCandidates, matchRange, searchText, selectedSkills, sortBy])

  const skeletonCards = Array.from({ length: 3 }, (_, index) => `candidate-skeleton-${index}`)

  if (isLoading || isSharedLoading) {
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
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
            }}
          >
            ← Upload New Resumes
          </button>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.75rem', fontFamily: 'var(--font-display)' }}>
            ⏳ Parsing resume...
          </h1>
          <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
            We are processing resumes. This can take 1-5 minutes.
          </p>
          <p style={{ color: 'var(--accent)', marginBottom: '1.5rem' }}>Progress: {Math.max(0, Math.min(100, Number(loadingProgress || 0)))}%</p>

          <div style={{ display: 'grid', gap: '1rem' }}>
            {skeletonCards.map((skeletonCard) => (
              <div
                key={skeletonCard}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  background: 'var(--card)',
                  animation: 'pulseSkeleton 1.6s ease-in-out infinite',
                }}
              >
                <div style={{ height: '16px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', width: '35%', marginBottom: '0.75rem' }} />
                <div style={{ height: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', width: '60%', marginBottom: '0.5rem' }} />
                <div style={{ height: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', width: '50%' }} />
              </div>
            ))}
          </div>
          <style>{`
            @keyframes pulseSkeleton {
              0% { opacity: 0.45; }
              50% { opacity: 0.95; }
              100% { opacity: 0.45; }
            }
          `}</style>
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

      <BulkActions selectedCount={selectedCandidates.length}>
        <button className="touch-target" onClick={() => exportCSV(selectedCandidates)} type="button">📥 Export CSV</button>
        <button className="touch-target" onClick={() => emailForm(selectedCandidates)} type="button">📤 Export to Email</button>
        <button className="touch-target" onClick={() => addToShortlist(selectedCandidates)} type="button">⭐ Add to Shortlist</button>
        <button className="touch-target" onClick={() => sendFeedbackForm(selectedCandidates)} type="button">📧 Send Feedback</button>
        <button className="touch-target" onClick={() => deleteSelected(selectedCandidates)} type="button">🗑️ Delete</button>
      </BulkActions>

      <div className="candidate-results-table-wrapper">
        <table className="candidate-results-table">
          <thead>
            <tr>
              <th>
                <input
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  aria-label="Select all candidates"
                  type="checkbox"
                />
              </th>
              <th>Candidate</th>
              <th>Fit</th>
              <th>Score</th>
              <th>Top skills</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((candidate) => (
              <tr key={`summary-${candidate._bulkKey}`}>
                <td data-label="Select">
                  <input
                    checked={selectedIds.includes(candidate._bulkKey)}
                    onChange={() => toggleCandidateSelection(candidate._bulkKey)}
                    aria-label={`Select ${candidate.name}`}
                    type="checkbox"
                  />
                </td>
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
        {filtered.map((candidate) => {
          const candidateSkills = Array.isArray(candidate.skills)
            ? candidate.skills
            : String(candidate.skills || '')
              .split(',')
              .map((skill) => skill.trim())
              .filter(Boolean)
          const candidatePros = Array.isArray(candidate.pros) ? candidate.pros : []
          const candidateCons = Array.isArray(candidate.cons) ? candidate.cons : []
          const tier = getTierBadge(candidate.tier)

          return (
            <div
              className="candidate-result-card"
              key={candidate._bulkKey}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '2rem',
                transition: 'all 0.3s'
              }}
            >
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    checked={selectedIds.includes(candidate._bulkKey)}
                    onChange={() => toggleCandidateSelection(candidate._bulkKey)}
                    aria-label={`Select ${candidate.name}`}
                    type="checkbox"
                  />
                  Select candidate
                </label>
              </div>

              {/* Top Section */}
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
