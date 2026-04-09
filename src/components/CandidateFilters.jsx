import { useMemo } from 'react'

function parseSkills(rawSkills) {
  if (Array.isArray(rawSkills)) {
    return rawSkills
      .map((skill) => String(skill || '').trim())
      .filter(Boolean)
  }

  return String(rawSkills || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)
}

export default function CandidateFilters({
  candidates = [],
  searchText = '',
  selectedSkills = [],
  expRange = { min: '', max: '' },
  matchRange = { min: '', max: '' },
  sortBy = 'match_score',
  onSearch,
  onSkillsFilter,
  onExperienceFilter,
  onMatchFilter,
  onSort,
}) {
  const allSkills = useMemo(() => {
    const skills = new Set()

    candidates.forEach((candidate) => {
      parseSkills(candidate?.skills).forEach((skill) => skills.add(skill))
    })

    return [...skills].sort((a, b) => a.localeCompare(b))
  }, [candidates])

  const toggleSkill = (skill) => {
    const alreadySelected = selectedSkills.includes(skill)
    const next = alreadySelected
      ? selectedSkills.filter((selected) => selected !== skill)
      : [...selectedSkills, skill]

    onSkillsFilter?.(next)
  }

  return (
    <div className="candidate-results-controls" style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem', display: 'grid', gap: '1rem' }}>
      <div>
        <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Search</label>
        <input
          type="text"
          value={searchText}
          onChange={(event) => onSearch?.(event.target.value)}
          placeholder="Search name, email, or phone"
          className="touch-target"
          style={{
            width: '100%',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
          }}
        />
      </div>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Experience range (years)</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="number"
              min="0"
              value={expRange?.min ?? ''}
              onChange={(event) => onExperienceFilter?.({ ...expRange, min: event.target.value })}
              placeholder="Min"
              className="touch-target"
              style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem', borderRadius: '6px' }}
            />
            <input
              type="number"
              min="0"
              value={expRange?.max ?? ''}
              onChange={(event) => onExperienceFilter?.({ ...expRange, max: event.target.value })}
              placeholder="Max"
              className="touch-target"
              style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem', borderRadius: '6px' }}
            />
          </div>
        </div>

        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Match score range</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="number"
              min="0"
              max="100"
              value={matchRange?.min ?? ''}
              onChange={(event) => onMatchFilter?.({ ...matchRange, min: event.target.value })}
              placeholder="Min"
              className="touch-target"
              style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem', borderRadius: '6px' }}
            />
            <input
              type="number"
              min="0"
              max="100"
              value={matchRange?.max ?? ''}
              onChange={(event) => onMatchFilter?.({ ...matchRange, max: event.target.value })}
              placeholder="Max"
              className="touch-target"
              style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem', borderRadius: '6px' }}
            />
          </div>
        </div>

        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Sort by</label>
          <select
            value={sortBy}
            onChange={(event) => onSort?.(event.target.value)}
            className="touch-target"
            style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem', borderRadius: '6px' }}
          >
            <option value="name">Name (A-Z)</option>
            <option value="match_score">Match score (high-low)</option>
            <option value="experience">Experience (high-low)</option>
            <option value="upload_date">Upload date (newest)</option>
          </select>
        </div>
      </div>

      <div>
        <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Skills</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {allSkills.length === 0 && <span style={{ color: 'var(--muted)' }}>No skills available</span>}
          {allSkills.map((skill) => {
            const active = selectedSkills.includes(skill)
            return (
              <button
                type="button"
                key={skill}
                onClick={() => toggleSkill(skill)}
                className="touch-target"
                style={{
                  background: active ? 'rgba(90,255,184,0.2)' : 'var(--card)',
                  border: '1px solid var(--border)',
                  color: active ? 'var(--accent-2)' : 'var(--text)',
                  borderRadius: '999px',
                  padding: '0.35rem 0.8rem',
                  cursor: 'pointer',
                }}
              >
                {skill}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
