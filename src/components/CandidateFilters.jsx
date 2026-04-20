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
  expRange = { min: '0', max: '50' },
  sortBy = 'name',
  onSearch,
  onSkillsFilter,
  onExperienceFilter,
  onSort,
}) {
  const allSkills = useMemo(() => {
    const skills = new Set()

    candidates.forEach((candidate) => {
      parseSkills(candidate?.skills).forEach((skill) => skills.add(skill))
    })

    return [...skills].sort((a, b) => a.localeCompare(b))
  }, [candidates])

  const experienceMin = Number(expRange?.min || 0)
  const experienceMax = Number(expRange?.max || 50)

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
        <label style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Search</label>
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
            color: 'var(--color-text-primary)',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
          }}
        />
      </div>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <label style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>
            Experience years: {experienceMin} - {experienceMax}
          </label>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <input
              type="range"
              min="0"
              max="50"
              step="1"
              value={experienceMin}
              onChange={(event) => onExperienceFilter?.({ min: event.target.value, max: String(Math.max(Number(event.target.value), experienceMax)) })}
              className="touch-target"
            />
            <input
              type="range"
              min="0"
              max="50"
              step="1"
              value={experienceMax}
              onChange={(event) => onExperienceFilter?.({ min: String(Math.min(experienceMin, Number(event.target.value))), max: event.target.value })}
              className="touch-target"
            />
          </div>
        </div>

        <div>
          <label style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Sort by</label>
          <select
            value={sortBy}
            onChange={(event) => onSort?.(event.target.value)}
            className="touch-target"
            style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--color-text-primary)', padding: '0.5rem', borderRadius: '6px' }}
          >
            <option value="name">Name (A-Z)</option>
            <option value="experience">Experience (high-low)</option>
            <option value="upload_date">Upload date (newest)</option>
          </select>
        </div>
      </div>

      <div>
        <label style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Skills</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {allSkills.length === 0 && <span style={{ color: 'var(--color-text-secondary)' }}>No skills available</span>}
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
                  color: active ? 'var(--color-accent-green-hover)' : 'var(--color-text-primary)',
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
