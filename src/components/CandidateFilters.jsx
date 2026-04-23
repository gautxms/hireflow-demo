import { useMemo, useState } from 'react'

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

function normalizeSkillKey(skill) {
  return String(skill || '')
    .trim()
    .toLowerCase()
    .replace(/\s*[()]/g, '')
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
  const [skillSearch, setSkillSearch] = useState('')
  const [showAll, setShowAll] = useState(false)

  const allSkills = useMemo(() => {
    const skills = new Set()

    candidates.forEach((candidate) => {
      parseSkills(candidate?.skills).forEach((skill) => skills.add(skill))
    })

    return [...skills]
  }, [candidates])

  const dedupedSkills = useMemo(() => {
    const uniqueByKey = new Map()

    allSkills
      .map((skill) => skill.trim())
      .forEach((skill) => {
        const key = normalizeSkillKey(skill)
        if (!key || uniqueByKey.has(key)) return
        uniqueByKey.set(key, skill)
      })

    return [...uniqueByKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allSkills])

  const visibleSkills = useMemo(
    () => dedupedSkills.filter((skill) => skill.label.toLowerCase().includes(skillSearch.toLowerCase())),
    [dedupedSkills, skillSearch],
  )

  const displaySkills = showAll ? visibleSkills : visibleSkills.slice(0, 24)

  const experienceMin = Number(expRange?.min || 0)
  const experienceMax = Number(expRange?.max || 50)

  const toggleSkill = (skillKey) => {
    const alreadySelected = selectedSkills.includes(skillKey)
    const next = alreadySelected
      ? selectedSkills.filter((selected) => selected !== skillKey)
      : [...selectedSkills, skillKey]

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
            className="touch-target filter-sort-select"
          >
            <option value="name">Name (A-Z)</option>
            <option value="experience">Experience (high-low)</option>
            <option value="upload_date">Upload date (newest)</option>
          </select>
        </div>
      </div>

      <div>
        <label style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Skills</label>
        <input
          className="filter-skill-search"
          type="text"
          placeholder="Search skills..."
          value={skillSearch}
          onChange={(event) => {
            setSkillSearch(event.target.value)
            setShowAll(true)
          }}
        />
        <div className="filter-skill-grid">
          {dedupedSkills.length === 0 && <span style={{ color: 'var(--color-text-secondary)' }}>No skills available</span>}
          {displaySkills.map((skill) => {
            const active = selectedSkills.includes(skill.key)
            return (
              <button
                type="button"
                key={skill.key}
                onClick={() => toggleSkill(skill.key)}
                className={`touch-target filter-skill-pill${active ? ' selected' : ''}`}
              >
                {skill.label}
              </button>
            )
          })}
        </div>
        {!showAll && visibleSkills.length > 24 && (
          <button type="button" className="filter-show-more" onClick={() => setShowAll(true)}>
            Show {visibleSkills.length - 24} more skills
          </button>
        )}
      </div>
    </div>
  )
}
