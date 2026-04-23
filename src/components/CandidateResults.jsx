import { useCallback, useEffect, useMemo, useState } from 'react'
import ShortlistManager from './ShortlistManager'
import BulkActions from './BulkActions'
import CandidateFilters from './CandidateFilters'
import {
  buildResultsQueryParams,
  normalizeNumericRange,
  normalizeSortBy,
  paginateCandidates,
  resolveCandidateResumeUuid,
  toDisplayText,
} from './candidateResultsState'
import { applyOptimisticTagUpdate } from './candidateTagState'
import API_BASE from '../config/api'
import {
  computeAllVisibleSelected,
  getSelectedCandidates,
  pruneSelection,
  toggleSelectAllVisible,
  toggleSelection,
} from './candidateSelectionState'
import '../styles/candidate-results.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

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
  if (typeof experience === 'number' && Number.isFinite(experience)) {
    return experience
  }

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
    sortBy = 'name',
  } = filters || {}

  const query = searchText.trim().toLowerCase()
  const expMin = expRange?.min === '' ? null : Number(expRange?.min)
  const expMax = expRange?.max === '' ? null : Number(expRange?.max)

  const filtered = candidates.filter((candidate) => {
    if (query) {
      const searchable = `${candidate?.name || ''} ${candidate?.email || ''} ${candidate?.phone || ''}`.toLowerCase()
      if (!searchable.includes(query)) {
        return false
      }
    }

    const candidateSkills = parseSkills(candidate?.skills).map((skill) => skill.toLowerCase())
    if (selectedSkills.length > 0) {
      const hasAtLeastOneSkill = selectedSkills.some((skill) => candidateSkills.includes(String(skill).toLowerCase()))
      if (!hasAtLeastOneSkill) {
        return false
      }
    }

    const years = parseYears(candidate?.experience_years ?? candidate?.experience)
    if (expMin !== null && years < expMin) {
      return false
    }

    if (expMax !== null && years > expMax) {
      return false
    }

    return true
  })

  return [...filtered].sort((a, b) => {
    if (sortBy === 'name') {
      return String(a?.name || '').localeCompare(String(b?.name || ''))
    }

    if (sortBy === 'experience') {
      return parseYears(b?.experience_years ?? b?.experience) - parseYears(a?.experience_years ?? a?.experience)
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
  const [expRange, setExpRange] = useState({ min: '0', max: '50' })
  const [sortBy, setSortBy] = useState('name')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [resultsError, setResultsError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [deletedIds, setDeletedIds] = useState([])

  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [shortlistDetails, setShortlistDetails] = useState(null)
  const [shortlistSort, setShortlistSort] = useState('rating_desc')
  const [shortlistLoading, setShortlistLoading] = useState(false)
  const [shortlistError, setShortlistError] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [candidateTags, setCandidateTags] = useState({})

  const rawCandidates = Array.isArray(candidates)
    ? candidates
    : Array.isArray(candidates?.candidates)
      ? candidates.candidates
      : []
  const hasJobDescription = Boolean(candidates?.parseMeta?.hasJobDescription)

  const displayCandidates = rawCandidates.length > 0 ? rawCandidates : null

  const hasRenderableCandidates = Array.isArray(displayCandidates)
    && displayCandidates.length > 0
    && displayCandidates.every((candidate) => candidate && (Array.isArray(candidate.skills) || typeof candidate.skills === 'string'))

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }, [])

  const loadShortlists = useCallback(async () => {
    try {
      setShortlistLoading(true)
      setShortlistError('')

      const response = await fetch(`${API_BASE}/shortlists`, {
        method: 'GET',
        headers: authHeaders(),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load shortlists')
      }

      const nextShortlists = Array.isArray(payload.shortlists) ? payload.shortlists : []
      setShortlists(nextShortlists)

      if (!selectedShortlistId && nextShortlists[0]?.id) {
        setSelectedShortlistId(nextShortlists[0].id)
      }
    } catch (error) {
      setShortlistError(error.message || 'Unable to load shortlists')
    } finally {
      setShortlistLoading(false)
    }
  }, [authHeaders, selectedShortlistId])

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
      setShortlistError('')

      const response = await fetch(`${API_BASE}/shortlists/${shortlistId}?${sortMap[sortKey] || sortMap.rating_desc}`, {
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
  }, [authHeaders, shortlistSort])

  const createShortlist = useCallback(async ({ name, description }) => {
    try {
      setShortlistLoading(true)
      setShortlistError('')

      const response = await fetch(`${API_BASE}/shortlists`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, description }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create shortlist')
      }

      await loadShortlists()

      const createdId = payload.shortlist?.id
      if (createdId) {
        setSelectedShortlistId(createdId)
        await loadShortlistDetails(createdId)
      }
    } catch (error) {
      setShortlistError(error.message || 'Unable to create shortlist')
    } finally {
      setShortlistLoading(false)
    }
  }, [authHeaders, loadShortlistDetails, loadShortlists])

  const addCandidateToShortlist = useCallback(async (candidate) => {
    try {
      if (!selectedShortlistId) {
        throw new Error('Create or select a shortlist first')
      }

      const derivedRating = Math.max(1, Math.min(5, Math.round(Number(candidate?.score || 0) / 20)))

      const resumeId = candidate?.resumeId || candidate?.resume_id || candidate?.id
      const response = await fetch(`${API_BASE}/shortlists/${selectedShortlistId}/candidates`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          resumeId,
          notes: `Added from ranking: ${candidate?.name || 'Unknown candidate'}`,
          rating: derivedRating,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to add candidate to shortlist')
      }

      return true
    } catch (error) {
      setShortlistError(error.message || 'Unable to add candidate to shortlist')
      return false
    }
  }, [authHeaders, selectedShortlistId])

  const removeCandidateFromShortlist = useCallback(async (resumeId) => {
    try {
      if (!selectedShortlistId || !resumeId) {
        return
      }

      setShortlistLoading(true)
      setShortlistError('')
      const response = await fetch(`${API_BASE}/shortlists/${selectedShortlistId}/candidates/${resumeId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to remove candidate from shortlist')
      }

      await Promise.all([
        loadShortlists(),
        loadShortlistDetails(selectedShortlistId),
      ])
    } catch (error) {
      setShortlistError(error.message || 'Unable to remove candidate from shortlist')
    } finally {
      setShortlistLoading(false)
    }
  }, [authHeaders, loadShortlistDetails, loadShortlists, selectedShortlistId])

  useEffect(() => {
    loadShortlists()
  }, [loadShortlists])

  useEffect(() => {
    if (!selectedShortlistId) {
      return
    }

    loadShortlistDetails(selectedShortlistId)
  }, [loadShortlistDetails, selectedShortlistId])
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

    return filterAndSortCandidates(candidateRows, {
      searchText,
      selectedSkills,
      expRange,
      sortBy: normalizeSortBy(sortBy),
    })
  }, [candidateRows, expRange, hasRenderableCandidates, searchText, selectedSkills, sortBy])

  const { rows: visibleCandidates, pagination } = useMemo(() => paginateCandidates(filtered, page, pageSize), [filtered, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [searchText, selectedSkills, expRange.min, expRange.max, sortBy])

  useEffect(() => {
    setSelectedIds((current) => pruneSelection(current, filtered))
  }, [filtered])

  const selectedCandidates = getSelectedCandidates(filtered, selectedIds)
  const allFilteredSelected = computeAllVisibleSelected(visibleCandidates, selectedIds)
  const activeScore = useCallback((candidate) => {
    const jdScore = candidate?.matchScore?.score
    const profileScore = candidate?.profile_score ?? candidate?.score
    const resolved = hasJobDescription ? jdScore : profileScore
    return Number(resolved ?? 0)
  }, [hasJobDescription])

  const avgScore = filtered.length
    ? Math.round(filtered.reduce((sum, candidate) => sum + activeScore(candidate), 0) / filtered.length)
    : 0
  const strongCount = filtered.filter((candidate) => activeScore(candidate) >= 80).length
  const sortedCandidates = useMemo(
    () => [...visibleCandidates].sort((a, b) => activeScore(b) - activeScore(a)),
    [activeScore, visibleCandidates],
  )

  const toggleCandidateSelection = (candidateKey) => {
    setSelectedIds((currentSelected) => toggleSelection(currentSelected, candidateKey))
  }

  const toggleSelectAllFiltered = () => {
    setSelectedIds((currentSelected) => toggleSelectAllVisible(currentSelected, visibleCandidates))
  }

  const exportCSV = async (selected) => {
    const effectiveRows = selected.length > 0 ? selected : filtered

    try {
      setResultsError('')
      const response = await fetch(`${API_BASE}/results/export/csv`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          candidates: effectiveRows,
          sortBy: normalizeSortBy(sortBy),
          sortOrder: normalizeSortBy(sortBy) === 'name' ? 'asc' : 'desc',
          filters: {
            search: searchText,
            skills: selectedSkills,
            experienceMin: expRange.min,
            experienceMax: expRange.max,
          },
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Unable to export CSV')
      }

      const csvBlob = await response.blob()
      const url = URL.createObjectURL(csvBlob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `hireflow-candidates-${Date.now()}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setResultsError(error.message || 'Unable to export CSV')
    }
  }

  const emailForm = (selected) => {
    const recipients = selected.map((candidate) => candidate.email).filter(Boolean)
    if (recipients.length === 0) {
      alert('No candidate emails found. Please add emails before exporting to email.')
      return
    }
    window.location.href = `mailto:${recipients.join(',')}?subject=HireFlow%20Feedback%20Form`
  }

  const addToShortlist = async (selected) => {
    if (selected.length === 0) {
      return
    }

    let successCount = 0
    for (const candidate of selected) {
      const ok = await addCandidateToShortlist(candidate)
      if (ok) {
        successCount += 1
      }
    }

    if (successCount > 0) {
      await Promise.all([
        loadShortlists(),
        loadShortlistDetails(selectedShortlistId),
      ])
      alert(`Added ${successCount} candidate(s) to shortlist.`)
    }
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

  const mutateSelectedTags = async (operation) => {
    const tags = tagDraft.split(',').map((tag) => tag.trim()).filter(Boolean)
    if (tags.length === 0 || selectedCandidates.length === 0) {
      return
    }

    const selectedWithResume = selectedCandidates
      .map((candidate) => ({
        key: candidate._bulkKey,
        resumeId: resolveCandidateResumeUuid(candidate),
      }))
      .filter((candidate) => Boolean(candidate.resumeId))

    if (selectedWithResume.length === 0) {
      setResultsError('No selected candidates have a resume ID available for tagging.')
      return
    }

    const { next, rollback } = applyOptimisticTagUpdate(
      candidateTags,
      selectedWithResume.map((candidate) => candidate.key),
      tags,
      operation,
    )
    setCandidateTags(next)

    try {
      setResultsError('')
      const response = await fetch(`${API_BASE}/candidates/tags/bulk`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          operation,
          tags,
          resumeIds: selectedWithResume.map((candidate) => candidate.resumeId),
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to update candidate tags')
      }
      setTagDraft('')
    } catch (error) {
      setCandidateTags(rollback)
      setResultsError(error.message || 'Unable to update candidate tags')
    }
  }

  const createShareLink = async () => {
    try {
      setResultsError('')
      const response = await fetch(`${API_BASE}/results/share`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          candidates: filtered,
          query: Object.fromEntries(buildResultsQueryParams({ searchText, selectedSkills, expRange, sortBy, page, pageSize })),
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create share link')
      }

      const origin = window.location.origin
      const shareUrl = `${origin}${payload.sharePath}`
      await navigator.clipboard.writeText(shareUrl)
      alert('Share link copied to clipboard.')
    } catch (error) {
      setResultsError(error.message || 'Unable to create share link')
    }
  }

  const skeletonCards = Array.from({ length: 3 }, (_, index) => `candidate-skeleton-${index}`)

  if (isLoading || isSharedLoading) {
    return (
      <div className="candidate-results-page candidate-results-page--state">
        <div className="candidate-results-page__state-wrap">
          <button
            className="touch-target candidate-results-page__back-button"
            onClick={onBack}
          >
            ← Upload New Resumes
          </button>
          <h1 className="candidate-results-page__state-title">
            ⏳ Parsing resume...
          </h1>
          <p className="candidate-results-page__state-copy">
            We are processing resumes. This can take 1-5 minutes.
          </p>
          <p className="candidate-results-page__progress">Progress: {Math.max(0, Math.min(100, Number(loadingProgress || 0)))}%</p>

          <div className="candidate-results-page__skeleton-grid">
            {skeletonCards.map((skeletonCard) => (
              <div key={skeletonCard} className="candidate-results-page__skeleton-card">
                <div className="candidate-results-page__skeleton-line candidate-results-page__skeleton-line--lg" />
                <div className="candidate-results-page__skeleton-line candidate-results-page__skeleton-line--md" />
                <div className="candidate-results-page__skeleton-line candidate-results-page__skeleton-line--sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!hasRenderableCandidates) {
    return (
      <div className="candidate-results-page candidate-results-page--state">
        <div className="candidate-results-page__state-wrap">
          <button
            className="touch-target candidate-results-page__back-button"
            onClick={onBack}
          >
            ← Upload New Resumes
          </button>
          <h1 className="candidate-results-page__state-title candidate-results-page__state-title--compact">
            Candidate Ranking
          </h1>
          <p className="candidate-results-page__state-copy">Please upload resumes before viewing analysis.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="candidate-results-page">
      <div className="candidate-results-page__header">
        <button
          className="touch-target candidate-results-page__back-button"
          onClick={onBack}
        >
          ← Upload New Resumes
        </button>
        <h1 className="candidate-results-page__state-title candidate-results-page__state-title--compact">
          Candidate Ranking
        </h1>
        <p className="candidate-results-page__state-copy">
          {hasJobDescription
            ? `${pagination.total} candidates analyzed and ranked by fit`
            : `${pagination.total} candidates analyzed`}
        </p>
        {resultsError && <p className="candidate-results-page__error">{resultsError}</p>}
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
        onRemoveCandidate={removeCandidateFromShortlist}
        loading={shortlistLoading}
        error={shortlistError}
      />

      <CandidateFilters
        candidates={displayCandidates}
        searchText={searchText}
        selectedSkills={selectedSkills}
        expRange={expRange}
        sortBy={sortBy}
        onSearch={setSearchText}
        onSkillsFilter={setSelectedSkills}
        onExperienceFilter={(next) => setExpRange(normalizeNumericRange(next, { min: 0, max: 50 }))}
        onSort={(next) => setSortBy(normalizeSortBy(next))}
      />

      <BulkActions selectedCount={selectedCandidates.length}>
        <button className="touch-target bulk-btn" onClick={() => exportCSV(selectedCandidates)} type="button">📥 Export CSV</button>
        <button className="touch-target bulk-btn" onClick={() => emailForm(selectedCandidates)} type="button">📤 Export to Email</button>
        <button className="touch-target bulk-btn" onClick={() => addToShortlist(selectedCandidates)} type="button">⭐ Add to Shortlist</button>
        <button className="touch-target bulk-btn" onClick={() => sendFeedbackForm(selectedCandidates)} type="button">📧 Send Feedback</button>
        <button className="touch-target bulk-btn" onClick={createShareLink} type="button">🔗 Share View</button>
        <button className="touch-target bulk-btn danger" onClick={() => deleteSelected(selectedCandidates)} type="button">🗑️ Delete</button>
        <input
          className="touch-target candidate-results-page__tag-input"
          value={tagDraft}
          onChange={(event) => setTagDraft(event.target.value)}
          placeholder="tag1, tag2"
        />
        <button className="touch-target bulk-btn" onClick={() => mutateSelectedTags('add')} type="button">🏷️ Add Tags</button>
        <button className="touch-target bulk-btn" onClick={() => mutateSelectedTags('remove')} type="button">➖ Remove Tags</button>
      </BulkActions>

      <div className="ranking-stats">
        <div className="ranking-stat">
          <div className="ranking-stat-num">{filtered.length}</div>
          <div className="ranking-stat-label">Analysed</div>
        </div>
        <div className="ranking-stat">
          <div className="ranking-stat-num ranking-stat-num--strong">{strongCount}</div>
          <div className="ranking-stat-label">Strong matches</div>
        </div>
        <div className="ranking-stat">
          <div className="ranking-stat-num">{avgScore}%</div>
          <div className="ranking-stat-label">Avg score</div>
        </div>
      </div>

      <div className="cand-list">
        <div className="cand-row cand-row--header" onClick={toggleSelectAllFiltered} role="button" tabIndex={0} onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleSelectAllFiltered()
          }
        }}>
          <div className="cand-rank">#</div>
          <div className="cand-avatar">ALL</div>
          <div className="cand-main">
            <div className="cand-name">Select all on this page</div>
          </div>
          <div className="cand-score-block" />
          <input
            type="checkbox"
            className="cand-check"
            checked={allFilteredSelected}
            onChange={(event) => {
              event.stopPropagation()
              toggleSelectAllFiltered()
            }}
            onClick={(event) => event.stopPropagation()}
            aria-label="Select all candidates"
          />
        </div>
        {sortedCandidates.map((candidate, index) => {
          const initials = String(candidate?.name || '')
            .split(' ')
            .map((part) => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()
          const candidateSkills = Array.isArray(candidate?.top_skills)
            ? candidate.top_skills
            : parseSkills(candidate?.skills)
          const scoreValue = hasJobDescription ? candidate?.matchScore?.score : (candidate?.profile_score ?? candidate?.score)
          const score = Number(scoreValue ?? 0)
          const isSelected = selectedIds.includes(candidate._bulkKey)
          const scoreBand = score >= 80 ? 'strong' : score >= 60 ? 'good' : 'possible'

          return (
            <div
              className={`cand-row ${isSelected ? 'cand-row--selected' : ''}`}
              key={candidate._bulkKey}
              onClick={() => {
                window.location.href = `/candidates/${candidate.id}`
              }}
            >
              <div className="cand-rank">#{index + 1}</div>

              <div className="cand-avatar">{initials || 'NA'}</div>

              <div className="cand-main">
                <div className="cand-name">{toDisplayText(candidate.name)}</div>
                <div className="cand-meta">
                  {candidate.seniority_level && <span className="cand-seniority-badge">{candidate.seniority_level}</span>}
                  {candidate.years_experience != null && <span>{candidate.years_experience} yrs exp</span>}
                  {candidate.location && <span>{candidate.location}</span>}
                </div>
                <div className="cand-skill-list">
                  {candidateSkills.slice(0, 4).map((skill) => (
                    <span className="cand-skill-pill" key={`${candidate._bulkKey}-${skill}`}>{skill}</span>
                  ))}
                </div>
              </div>

              <div className="cand-score-block">
                {scoreValue != null ? (
                  <>
                    <div className={`cand-score-num cand-score-num--${scoreBand}`}>{score}<span className="cand-pct">%</span></div>
                    <div className="cand-bar-track">
                      <progress
                        className={`cand-bar-fill cand-bar-fill--${scoreBand}`}
                        value={Math.max(0, Math.min(score, 100))}
                        max={100}
                      />
                    </div>
                    <div className={`cand-fit-label cand-fit-label--${scoreBand}`}>
                      {candidate.matchScore?.fit ?? (score >= 80 ? 'Strong' : score >= 60 ? 'Good' : 'Possible')}
                    </div>
                  </>
                ) : <div className="cand-score-empty">Not scored</div>}
              </div>

              <input
                type="checkbox"
                className="cand-check"
                checked={isSelected}
                onChange={(event) => {
                  event.stopPropagation()
                  toggleCandidateSelection(candidate._bulkKey)
                }}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Select ${toDisplayText(candidate.name, 'candidate')}`}
              />
            </div>
          )
        })}
      </div>


      {visibleCandidates.length === 0 && (
        <div className="candidate-results-page__empty-note">
          No candidates match the current filters.
        </div>
      )}

      <div className="candidate-results-page__pagination">
        <button className="touch-target" type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <span className="candidate-results-page__pagination-label">Page {pagination.page} of {pagination.totalPages}</span>
        <button className="touch-target" type="button" disabled={!pagination.hasNextPage} onClick={() => setPage((current) => current + 1)}>Next</button>
        <select className="touch-target" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
          <option value={10}>10 / page</option>
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
        </select>
      </div>
      <div className="candidate-results-list candidate-results-list--cards">
        {visibleCandidates.map((candidate) => {
          const candidateSkills = parseSkills(candidate.skills)
          const candidateStrengths = Array.isArray(candidate.strengths)
            ? candidate.strengths.map((item) => toDisplayText(item, '')).filter(Boolean)
            : Array.isArray(candidate.pros)
              ? candidate.pros.map((item) => toDisplayText(item, '')).filter(Boolean)
              : []
          const candidateConsiderations = Array.isArray(candidate.considerations)
            ? candidate.considerations.map((item) => toDisplayText(item, '')).filter(Boolean)
            : Array.isArray(candidate.cons)
              ? candidate.cons.map((item) => toDisplayText(item, '')).filter(Boolean)
              : []
          const score = candidate.matchScore?.score ?? candidate.profile_score ?? candidate.score
          const hasRoleFitScore = candidate.matchScore?.score != null
          const scoreColor = score >= 80 ? '#c8ff00' : score >= 60 ? '#7ab3f7' : '#ffa500'
          const scoreGradient = score >= 80 ? 'linear-gradient(90deg, #c8ff00, #39ff9f)' : score >= 60 ? '#7ab3f7' : '#ffa500'
          const initials = toDisplayText(candidate.name, 'Candidate')
            .split(' ')
            .map((namePart) => namePart[0] || '')
            .join('')
            .slice(0, 2)
            .toUpperCase()
          const skillsByCategory = {
            'Tools & Platforms': candidate.skills_structured?.tools_and_platforms,
            Methodologies: candidate.skills_structured?.methodologies,
            'Domain Expertise': candidate.skills_structured?.domain_expertise,
            'Soft Skills': candidate.skills_structured?.soft_skills,
          }
          const experienceEntries = Array.isArray(candidate.experience) ? candidate.experience : []

          return (
            <div
              className="candidate-result-card rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-8 shadow-[var(--shadow-md)] transition-all duration-300"
              key={candidate._bulkKey}
            >
              <div className="candidate-results__selection">
                <label className="candidate-results__selection-label">
                  <input
                    checked={selectedIds.includes(candidate._bulkKey)}
                    onChange={() => toggleCandidateSelection(candidate._bulkKey)}
                    aria-label={`Select ${toDisplayText(candidate.name, 'candidate')}`}
                    type="checkbox"
                  />
                  Select candidate
                </label>
              </div>

              <div className="profile-layout">
                <aside className="profile-left">
                  <div className="profile-header-block">
                    <div className="profile-avatar-lg">{initials}</div>
                    <div>
                      <h1 className="profile-name">{toDisplayText(candidate.name)}</h1>
                      <div className="profile-subtitle">
                        {[candidate.current_title, candidate.current_company].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>

                  {score != null && (
                    <div className="profile-score-card">
                      <div className="profile-score-eyebrow">{hasRoleFitScore ? 'Role Fit Score' : 'Profile Score'}</div>
                      <div className="profile-score-big" style={{ color: scoreColor }}>{score}<span>%</span></div>
                      <div className="profile-score-bar-track">
                        <div className="profile-score-bar-fill" style={{ width: `${Math.max(0, Math.min(score, 100))}%`, background: scoreGradient }} />
                      </div>
                      {candidate.matchScore?.fit && <div className="profile-score-fit" style={{ color: scoreColor }}>{candidate.matchScore.fit} match</div>}
                      {candidate.seniority_level && <div className="profile-score-seniority">{candidate.seniority_level}</div>}
                    </div>
                  )}

                  <div className="profile-contact-block">
                    {candidate.email && (
                      <a href={`mailto:${candidate.email}`} className="profile-contact-item">
                        <span className="profile-contact-dot" />
                        {candidate.email}
                      </a>
                    )}
                    {candidate.location && (
                      <div className="profile-contact-item">
                        <span className="profile-contact-dot" />
                        {candidate.location}
                      </div>
                    )}
                    {candidate.years_experience != null && (
                      <div className="profile-contact-item">
                        <span className="profile-contact-dot" />
                        {candidate.years_experience} years experience
                      </div>
                    )}
                  </div>

                  {candidateTags[candidate._bulkKey]?.length > 0 && (
                    <div className="profile-tag-row">
                      {candidateTags[candidate._bulkKey].map((tag) => (
                        <span className="profile-cat-tag" key={tag}>{tag}</span>
                      ))}
                    </div>
                  )}

                  <div className="profile-action-stack">
                    <button className="profile-btn-primary">Schedule Interview</button>
                    <button className="profile-btn-ghost">View Full Resume</button>
                    <button onClick={() => addCandidateToShortlist(candidate)} className="profile-btn-ghost">Add to Shortlist</button>
                  </div>
                </aside>

                <main className="profile-right">
                  <section className="profile-section">
                    <h2 className="profile-section-heading">Summary</h2>
                    <p className="profile-section-body">{toDisplayText(candidate.summary, 'No summary available')}</p>
                  </section>

                  <div className="profile-two-col">
                    <section className="profile-analysis-box profile-strengths-box">
                      <h2 className="profile-section-heading profile-heading-green">Strengths</h2>
                      {candidateStrengths.length > 0
                        ? candidateStrengths.map((strength, idx) => (
                          <div className="profile-analysis-row" key={idx}>{strength}</div>
                        ))
                        : <div className="profile-analysis-empty">Run re-analysis to generate AI insights.</div>}
                    </section>
                    <section className="profile-analysis-box profile-considerations-box">
                      <h2 className="profile-section-heading profile-heading-amber">Considerations</h2>
                      {candidateConsiderations.length > 0
                        ? candidateConsiderations.map((consideration, idx) => (
                          <div className="profile-analysis-row" key={idx}>{consideration}</div>
                        ))
                        : <div className="profile-analysis-empty">Run re-analysis to generate AI insights.</div>}
                    </section>
                  </div>

                  <section className="profile-section">
                    <h2 className="profile-section-heading">Skills</h2>
                    {candidate.skills_structured
                      ? Object.entries(skillsByCategory).map(([category, skills]) => skills?.length > 0 && (
                        <div className="profile-skill-group" key={category}>
                          <div className="profile-skill-cat-label">{category}</div>
                          <div className="profile-skill-pill-row">
                            {skills.map((skill) => (
                              <span className="profile-skill-pill" key={skill}>{skill}</span>
                            ))}
                          </div>
                        </div>
                      ))
                      : candidateSkills.length > 0
                        ? (
                          <div className="profile-skill-pill-row">
                            {candidateSkills.map((skill) => (
                              <span className="profile-skill-pill" key={skill}>{skill}</span>
                            ))}
                          </div>
                        )
                        : null}
                  </section>

                  {experienceEntries.length > 0 && (
                    <section className="profile-section">
                      <h2 className="profile-section-heading">Experience</h2>
                      {experienceEntries.map((job, idx) => (
                        <div className="profile-job-row" key={idx}>
                          <div className="profile-job-top">
                            <span className="profile-job-title">{job.title}</span>
                            <span className="profile-job-duration">
                              {job.durationText || [job.startDate, job.endDate].filter(Boolean).join(' – ')}
                            </span>
                          </div>
                          <div className="profile-job-company">{job.company}</div>
                          {job.description && <div className="profile-job-desc">{job.description}</div>}
                        </div>
                      ))}
                    </section>
                  )}

                  {candidate.matchScore?.score != null && (
                    <section className="profile-section">
                      <h2 className="profile-section-heading">Role Match Breakdown</h2>
                      <div className="profile-breakdown-grid">
                        {candidate.matchScore.breakdown?.requiredSkills && (
                          <div className="profile-breakdown-item">
                            <div className="profile-breakdown-label">Skills matched</div>
                            <div className="profile-breakdown-val">
                              {candidate.matchScore.breakdown.requiredSkills.matched}
                              /{candidate.matchScore.breakdown.requiredSkills.total}
                            </div>
                          </div>
                        )}
                        {candidate.matchScore.breakdown?.experience && (
                          <div className="profile-breakdown-item">
                            <div className="profile-breakdown-label">Experience</div>
                            <div className="profile-breakdown-val" style={{ color: candidate.matchScore.breakdown.experience.meetsMinimum ? '#c8ff00' : '#ffa500' }}>
                              {candidate.matchScore.breakdown.experience.candidateYears} yrs
                              {candidate.matchScore.breakdown.experience.meetsMinimum ? ' ✓' : ' (below min)'}
                            </div>
                          </div>
                        )}
                      </div>
                      {candidate.matchScore.reason && <div className="profile-match-reason">{candidate.matchScore.reason}</div>}
                    </section>
                  )}
                </main>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
