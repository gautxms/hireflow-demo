import { useMemo, useState } from 'react'

function parseSkills(rawSkills) {
  if (Array.isArray(rawSkills)) {
    return rawSkills
      .map((skill) => (typeof skill === 'object' && skill !== null
        ? skill.name || skill.label || JSON.stringify(skill)
        : skill))
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
  sortBy = 'score',
  onSearch,
  onSkillsFilter,
  onExperienceFilter,
  onSort,
  shortlistOpen = false,
  onToggleShortlist,
}) {
  const [skillSearch, setSkillSearch] = useState('')
  const [showAllSkills, setShowAllSkills] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

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

  const experienceMin = Number(expRange?.min || 0)
  const experienceMax = Number(expRange?.max || 50)
  const activeFilterCount = [
    selectedSkills.length > 0,
    experienceMin > 0 || experienceMax < 50,
  ].filter(Boolean).length

  const toggleSkill = (skillKey) => {
    const alreadySelected = selectedSkills.includes(skillKey)
    const next = alreadySelected
      ? selectedSkills.filter((selected) => selected !== skillKey)
      : [...selectedSkills, skillKey]

    onSkillsFilter?.(next)
  }

  const clearAllFilters = () => {
    onSkillsFilter?.([])
    onExperienceFilter?.({ min: '0', max: '50' })
    setSkillSearch('')
    setShowAllSkills(false)
  }

  return (
    <>
      <div className="filter-bar">
        <div className="filter-bar-search">
          <svg className="filter-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="touch-target filter-search-input"
            placeholder="Search candidates..."
            value={searchText}
            onChange={(event) => onSearch?.(event.target.value)}
          />
        </div>

        <select
          className="touch-target filter-sort-select"
          value={sortBy}
          onChange={(event) => onSort?.(event.target.value)}
        >
          <option value="score">Best match</option>
          <option value="name">Name A–Z</option>
          <option value="experience">Most experienced</option>
          <option value="upload_date">Recently added</option>
        </select>

        <button type="button" className="touch-target filter-filters-btn" onClick={() => setFilterOpen((open) => !open)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="11" y1="18" x2="13" y2="18" />
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="filter-active-count">{activeFilterCount}</span>
          )}
        </button>

        <button type="button" className="touch-target filter-shortlist-btn" onClick={() => onToggleShortlist?.(!shortlistOpen)}>
          Shortlists
        </button>
      </div>

      {filterOpen && (
        <div className="filter-popover">
          <div className="fp-section">
            <div className="fp-label">Experience (years)</div>
            <div className="fp-range-display">
              {experienceMin}
              {' '}
              –
              {' '}
              {experienceMax}
            </div>
            <input
              className="touch-target"
              type="range"
              min="0"
              max="50"
              step="1"
              value={experienceMin}
              onChange={(event) => {
                const nextMin = Number(event.target.value)
                onExperienceFilter?.({ min: String(nextMin), max: String(Math.max(nextMin, experienceMax)) })
              }}
            />
            <input
              className="touch-target"
              type="range"
              min="0"
              max="50"
              step="1"
              value={experienceMax}
              onChange={(event) => {
                const nextMax = Number(event.target.value)
                onExperienceFilter?.({ min: String(Math.min(experienceMin, nextMax)), max: String(nextMax) })
              }}
            />
          </div>

          <div className="fp-section">
            <div className="fp-label">Skills</div>
            <input
              type="text"
              className="touch-target fp-skill-search"
              placeholder="Search skills..."
              value={skillSearch}
              onChange={(event) => {
                setSkillSearch(event.target.value)
                setShowAllSkills(false)
              }}
            />
            <div className="fp-skill-grid">
              {dedupedSkills
                .filter((skill) => skill.label.toLowerCase().includes(skillSearch.toLowerCase()))
                .slice(0, showAllSkills ? undefined : 20)
                .map((skill) => (
                  <button
                    type="button"
                    key={skill.key}
                    className={`touch-target fp-skill-pill${selectedSkills.includes(skill.key) ? ' active' : ''}`}
                    onClick={() => toggleSkill(skill.key)}
                  >
                    {skill.label}
                  </button>
                ))}
              {dedupedSkills.length === 0 && <span className="candidate-filter-empty-skills">No skills available</span>}
            </div>
            {dedupedSkills.length > 20 && !showAllSkills && (
              <button type="button" className="touch-target fp-show-more" onClick={() => setShowAllSkills(true)}>
                +{dedupedSkills.length - 20} more skills
              </button>
            )}
          </div>

          <div className="fp-footer">
            <button type="button" className="touch-target fp-clear" onClick={clearAllFilters}>Clear all</button>
            <button type="button" className="touch-target fp-apply" onClick={() => setFilterOpen(false)}>
              Apply filters
            </button>
          </div>
        </div>
      )}
    </>
  )
}
