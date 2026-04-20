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
  resolveCandidateScoreState,
  resolveTierState,
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
          {pagination.total} candidates analyzed and ranked by fit
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
        <button className="touch-target" onClick={() => exportCSV(selectedCandidates)} type="button">📥 Export CSV</button>
        <button className="touch-target" onClick={() => emailForm(selectedCandidates)} type="button">📤 Export to Email</button>
        <button className="touch-target" onClick={() => addToShortlist(selectedCandidates)} type="button">⭐ Add to Shortlist</button>
        <button className="touch-target" onClick={() => sendFeedbackForm(selectedCandidates)} type="button">📧 Send Feedback</button>
        <button className="touch-target" onClick={createShareLink} type="button">🔗 Share View</button>
        <button className="touch-target" onClick={() => deleteSelected(selectedCandidates)} type="button">🗑️ Delete</button>
        <input
          className="touch-target candidate-results-page__tag-input"
          value={tagDraft}
          onChange={(event) => setTagDraft(event.target.value)}
          placeholder="tag1, tag2"
        />
        <button className="touch-target" onClick={() => mutateSelectedTags('add')} type="button">🏷️ Add Tags</button>
        <button className="touch-target" onClick={() => mutateSelectedTags('remove')} type="button">➖ Remove Tags</button>
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
            {visibleCandidates.map((candidate) => (
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
          const candidateSkills = Array.isArray(candidate.skills)
            ? candidate.skills
            : String(candidate.skills || '')
              .split(',')
              .map((skill) => skill.trim())
              .filter(Boolean)
          const candidatePros = Array.isArray(candidate.pros) ? candidate.pros : []
          const candidateCons = Array.isArray(candidate.cons) ? candidate.cons : []
          const scoreState = resolveCandidateScoreState(candidate.score)
          const tierState = resolveTierState(candidate.tier, candidate.score)

          return (
            <div
              className="candidate-result-card rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-8 shadow-[var(--shadow-md)] transition-all duration-300"
              key={candidate._bulkKey}
            >
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    checked={selectedIds.includes(candidate._bulkKey)}
                    onChange={() => toggleCandidateSelection(candidate._bulkKey)}
                    aria-label={`Select ${candidate.name}`}
                    type="checkbox"
                  />
                  Select candidate
                </label>
              </div>

              <div className="candidate-top-section" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2rem', marginBottom: '1.5rem', alignItems: 'start' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--color-text-primary)' }}>
                    {candidate.name}
                  </h2>
                  <p style={{ color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>📧 {candidate.email || 'No email provided'}</p>
                  <p style={{ color: 'var(--color-text-secondary)' }}>📍 {candidate.location || 'Unknown location'}</p>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '90px',
                    height: '90px',
                    borderRadius: '50%',
                    background: `conic-gradient(${scoreState.chartColor} ${candidate.score * 3.6}deg, rgba(255,255,255,0.1) 0deg)`,
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
                      color: scoreState.chartColor
                    }}>
                      {candidate.score}
                    </div>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Match Score</p>
                </div>

                <div>
                  <div className={`mb-3 rounded-full border px-4 py-2 text-center text-xs font-bold ${tierState.badgeClass}`}>
                    {`${tierState.icon} ${tierState.label.toUpperCase()}`}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Fit: {candidate.fit || 'N/A'}</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Experience: {candidate.experience || 'N/A'}</p>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>Summary</h3>
                <p style={{ color: 'var(--color-text-primary)', lineHeight: '1.6' }}>{candidate.summary || 'No summary available'}</p>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', color: 'var(--color-text-secondary)', marginBottom: '0.75rem' }}>Top Skills</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {candidateSkills.map((skill, idx) => (
                    <span
                      key={idx}
                      style={{
                        background: 'var(--color-accent-alpha-08)',
                        color: 'var(--color-accent-green)',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '20px',
                        fontSize: '0.85rem',
                        border: '1px solid var(--color-accent-alpha-15)'
                      }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
                {candidateTags[candidate._bulkKey]?.length > 0 ? (
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                    Tags: {candidateTags[candidate._bulkKey].join(', ')}
                  </p>
                ) : null}
              </div>

              <div className="candidate-evaluation-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ color: 'var(--color-success-text)', fontSize: '1rem', marginBottom: '0.75rem' }}>✅ Strengths</h3>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--color-text-primary)' }}>
                    {candidatePros.length > 0
                      ? candidatePros.map((pro, idx) => (
                        <li key={idx} style={{ marginBottom: '0.5rem', lineHeight: '1.5' }}>{pro}</li>
                      ))
                      : <li style={{ marginBottom: '0.5rem', lineHeight: '1.5' }}>No strengths listed.</li>}
                  </ul>
                </div>

                <div>
                  <h3 style={{ color: 'var(--color-warning-text)', fontSize: '1rem', marginBottom: '0.75rem' }}>⚠️ Considerations</h3>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--color-text-primary)' }}>
                    {candidateCons.length > 0
                      ? candidateCons.map((con, idx) => (
                        <li key={idx} style={{ marginBottom: '0.5rem', lineHeight: '1.5' }}>{con}</li>
                      ))
                      : <li style={{ marginBottom: '0.5rem', lineHeight: '1.5' }}>No concerns listed.</li>}
                  </ul>
                </div>
              </div>

              {/* CTA */}
              <div className="candidate-cta-row" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button className="min-h-11 rounded-[var(--radius-sm)] bg-[var(--color-accent-green)] px-6 py-2.5 text-sm font-bold text-[var(--color-bg-primary)] transition hover:brightness-95">
                  Schedule Interview
                </button>
                <button className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-accent-green)] px-6 py-2.5 text-sm font-bold text-[var(--color-accent-green)] transition hover:bg-[var(--color-accent-alpha-08)]">
                  View Full Profile
                </button>
                <button
                  onClick={() => addCandidateToShortlist(candidate)}
                  className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-accent-green)] px-6 py-2.5 text-sm font-bold text-[var(--color-accent-green)] transition hover:bg-[var(--color-accent-alpha-08)]"
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
