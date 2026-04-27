import { useCallback, useEffect, useMemo, useState } from 'react'
import ShortlistManager from './ShortlistManager'
import BulkActions from './BulkActions'
import CandidateFilters from './CandidateFilters'
import {
  buildResultsQueryParams,
  hasRenderableCandidates,
  normalizeCandidateForResults,
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
    return skills
      .map((skill) => (typeof skill === 'object' && skill !== null
        ? skill.name || skill.label || JSON.stringify(skill)
        : skill))
      .map((skill) => String(skill || '').trim())
      .filter(Boolean)
  }

  return String(skills || '')
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

function formatSkillLabel(skill) {
  if (typeof skill === 'object' && skill !== null) {
    return skill.name || skill.label || JSON.stringify(skill)
  }

  return skill
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

const toTenScale = (score) => {
  if (score == null) return null
  return (score / 10).toFixed(1)
}

const scoreTier = (score) => {
  if (score == null) return 'unscored'
  if (score >= 80) return 'strong'
  if (score >= 60) return 'possible'
  return 'low'
}

const activeScore = (candidate) => (
  candidate?.matchScore?.score ?? candidate?.profile_score ?? null
)

function filterAndSortCandidates(candidates, filters) {
  const {
    searchText = '',
    selectedSkills = [],
    expRange = { min: '', max: '' },
    sortBy = 'score',
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

    const candidateSkills = new Set(parseSkills(candidate?.skills).map(normalizeSkillKey))
    if (selectedSkills.length > 0) {
      const hasAtLeastOneSkill = selectedSkills.some((skill) => candidateSkills.has(normalizeSkillKey(skill)))
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
  const [sortBy, setSortBy] = useState('score')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [resultsError, setResultsError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [deletedIds, setDeletedIds] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [shortlistOpen, setShortlistOpen] = useState(false)

  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [shortlistDetails, setShortlistDetails] = useState(null)
  const [shortlistSort, setShortlistSort] = useState('rating_desc')
  const [shortlistLoading, setShortlistLoading] = useState(false)
  const [shortlistError, setShortlistError] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [candidateTags, setCandidateTags] = useState({})

  const rawCandidates = useMemo(() => (
    Array.isArray(candidates)
      ? candidates
      : Array.isArray(candidates?.candidates)
        ? candidates.candidates
        : []
  ), [candidates])
  const [hasJobDescription, setHasJobDescription] = useState(Boolean(candidates?.parseMeta?.hasJobDescription))

  const [liveCandidates, setLiveCandidates] = useState(rawCandidates)

  useEffect(() => {
    setLiveCandidates(rawCandidates)
  }, [rawCandidates])
  useEffect(() => {
    setHasJobDescription(Boolean(candidates?.parseMeta?.hasJobDescription))
  }, [candidates])

  const displayCandidates = liveCandidates.length > 0 ? liveCandidates : null

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

  const addCandidatesToShortlistBatch = useCallback(async (selected) => {
    if (!selectedShortlistId) {
      throw new Error('Create or select a shortlist first')
    }

    const resumeIds = selected
      .map((candidate) => candidate?.resumeId || candidate?.resume_id || candidate?.id)
      .map((resumeId) => String(resumeId || '').trim())
      .filter(Boolean)

    if (resumeIds.length === 0) {
      throw new Error('No valid resume IDs found in the selected candidates')
    }

    const response = await fetch(`${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        resumeIds,
        notes: `Added from ranking in bulk (${new Date().toISOString()})`,
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to add candidates to shortlist')
    }

    return payload
  }, [authHeaders, selectedShortlistId])

  const removeCandidateFromShortlist = useCallback(async (resumeId) => {
    try {
      if (!selectedShortlistId || !resumeId) {
        return
      }

      setShortlistLoading(true)
      setShortlistError('')
      const response = await fetch(`${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch-remove`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ resumeIds: [resumeId] }),
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
      .map((candidate, index) => normalizeCandidateForResults(candidate, index))
      .filter((candidate) => candidate._isRenderable)
      .filter((candidate) => !deletedIds.includes(candidate._bulkKey))
  }, [deletedIds, displayCandidates])

  const hasCandidatesToRender = hasRenderableCandidates(candidateRows)

  const filtered = useMemo(() => {
    if (!hasCandidatesToRender) {
      return []
    }

    return filterAndSortCandidates(candidateRows, {
      searchText,
      selectedSkills,
      expRange,
      sortBy: normalizeSortBy(sortBy),
    })
  }, [candidateRows, expRange, hasCandidatesToRender, searchText, selectedSkills, sortBy])

  const { rows: visibleCandidates, pagination } = useMemo(() => paginateCandidates(filtered, page, pageSize), [filtered, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [searchText, selectedSkills, expRange.min, expRange.max, sortBy])

  useEffect(() => {
    setSelectedIds((current) => pruneSelection(current, filtered))
  }, [filtered])

  const selectedCandidates = getSelectedCandidates(filtered, selectedIds)
  const allFilteredSelected = computeAllVisibleSelected(visibleCandidates, selectedIds)

  const avgScore = filtered.length
    ? Math.round(filtered.reduce((sum, candidate) => sum + Number(activeScore(candidate) ?? 0), 0) / filtered.length)
    : 0
  const strongCount = filtered.filter((candidate) => activeScore(candidate) >= 80).length
  const sortedCandidates = useMemo(() => (
    [...visibleCandidates].sort((a, b) => {
      return (activeScore(b) ?? -1) - (activeScore(a) ?? -1)
    })
  ), [visibleCandidates])

  const toggleCandidateSelection = (candidateKey) => {
    setSelectedIds((currentSelected) => toggleSelection(currentSelected, candidateKey))
  }

  const toggleSelectAllFiltered = () => {
    setSelectedIds((currentSelected) => toggleSelectAllVisible(currentSelected, visibleCandidates))
  }

  const handleCardClick = (id) => {
    setExpandedId((previousId) => {
      const nextId = previousId === id ? null : id
      if (nextId === id) {
        setTimeout(() => {
          document.getElementById('detail-drawer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 50)
      }
      return nextId
    })
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

    try {
      const payload = await addCandidatesToShortlistBatch(selected)
      const succeeded = Number(payload?.summary?.succeeded || 0)
      const failed = Number(payload?.summary?.failed || 0)
      const added = Number(payload?.summary?.added || 0)
      const updated = Number(payload?.summary?.updated || 0)

      if (succeeded > 0) {
        await Promise.all([
          loadShortlists(),
          loadShortlistDetails(selectedShortlistId),
        ])
      }

      if (failed > 0) {
        setShortlistError(`Added/updated ${succeeded} candidate(s); ${failed} failed. Check shortlist diagnostics for details.`)
      }

      alert(`Shortlist sync complete: ${added} added, ${updated} updated, ${failed} failed.`)
    } catch (error) {
      setShortlistError(error.message || 'Unable to add candidates to shortlist')
      let fallbackSuccessCount = 0
      for (const candidate of selected) {
        // Legacy endpoint fallback if the API has not rolled out batch yet.
        const ok = await addCandidateToShortlist(candidate)
        if (ok) {
          fallbackSuccessCount += 1
        }
      }

      if (fallbackSuccessCount > 0) {
      await Promise.all([
        loadShortlists(),
        loadShortlistDetails(selectedShortlistId),
      ])
        alert(`Added ${fallbackSuccessCount} candidate(s) to shortlist.`)
      }
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
  const expandedCandidate = useMemo(
    () => sortedCandidates.find((candidate) => candidate.id === expandedId),
    [expandedId, sortedCandidates],
  )

  useEffect(() => {
    if (expandedId && !expandedCandidate) {
      setExpandedId(null)
    }
  }, [expandedCandidate, expandedId])

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

  if (!hasCandidatesToRender) {
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
        shortlistOpen={shortlistOpen}
        onToggleShortlist={setShortlistOpen}
      />

      {shortlistOpen && (
        <>
          <div className="panel-overlay" onClick={() => setShortlistOpen(false)} aria-hidden="true" />
          <div className="shortlist-panel" role="dialog" aria-modal="true" aria-label="Candidate shortlists">
            <div className="sp-header">
              <div className="sp-title">Shortlists</div>
              <button type="button" className="touch-target sp-close" onClick={() => setShortlistOpen(false)}>✕</button>
            </div>

            <ShortlistManager
              shortlists={shortlists}
              selectedShortlistId={selectedShortlistId}
              shortlistDetails={shortlistDetails}
              onSelectShortlist={setSelectedShortlistId}
              onCreateShortlist={createShortlist}
              currentSort={shortlistSort}
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
          </div>
        </>
      )}

      {selectedCandidates.length > 0 && (
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
      )}

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
          <div className="ranking-stat-num">{(avgScore / 10).toFixed(1)}</div>
          <div className="ranking-stat-label">Avg score /10</div>
        </div>
      </div>

      <div className="results-select-all">
        <label className="results-select-all__label">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleSelectAllFiltered}
            aria-label="Select all candidates on this page"
          />
          Select all on this page
        </label>
      </div>

      <div className="results-grid">
        {sortedCandidates.map((candidate, index) => {
          const score = activeScore(candidate)
          const tier = scoreTier(score)
          const displayScore = toTenScale(score)
          const isExpanded = expandedId === candidate.id
          const initials = String(candidate?.name || '')
            .split(' ')
            .map((part) => part[0] || '')
            .join('')
            .slice(0, 2)
            .toUpperCase()
          const topSkills = parseSkills(
            Array.isArray(candidate.top_skills)
              ? candidate.top_skills
              : (candidate.top_skills || candidate.skills),
          )
          const selected = selectedIds.includes(candidate._bulkKey)

          return (
            <div
              key={candidate._bulkKey}
              className={`result-card result-card--${tier}${isExpanded ? ' result-card--open' : ''}`}
              onClick={() => handleCardClick(candidate.id)}
            >
              <div className="rc-rank">#{index + 1}</div>

              <div className="rc-top">
                <div className="rc-avatar">{initials || 'NA'}</div>
                <div className="rc-identity">
                  <div className="rc-name">{toDisplayText(candidate.name)}</div>
                  <div className="rc-meta">
                    {[candidate.current_title, candidate.location].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="rc-score-block">
                  {displayScore != null ? (
                    <>
                      <div className="rc-score-num">
                        {displayScore}
                        <span className="rc-score-denom">/10</span>
                      </div>
                      <div className={`rc-fit-label rc-fit--${tier}`}>
                        {tier === 'strong'
                          ? 'Strong match'
                          : tier === 'possible'
                            ? 'Possible match'
                            : 'Low match'}
                      </div>
                    </>
                  ) : (
                    <div className="rc-score-empty">Not scored</div>
                  )}
                </div>
              </div>

              {score != null && (
                <progress
                  className={`rc-bar-progress rc-bar--${tier}`}
                  value={score}
                  max={100}
                  aria-label={`Match score ${score} out of 100`}
                />
              )}

              {(candidate.matchScore?.reason || candidate.profile_score != null) && (
                <div className="rc-reasoning">
                  <div className="rc-reasoning-label">
                    <span className="rc-reasoning-dot" />
                    AI reasoning
                  </div>
                  <div className="rc-reasoning-text">
                    {candidate.matchScore?.reason
                      ?? 'General profile score based on experience depth, skill breadth, and career progression.'}
                  </div>
                </div>
              )}

              <div className="rc-skills">
                {topSkills.slice(0, 3).map((skill) => (
                  <span className="rc-skill" key={`${candidate._bulkKey}-${String(formatSkillLabel(skill))}`}>
                    {formatSkillLabel(skill)}
                  </span>
                ))}
                {topSkills.length > 3 && (
                  <span className="rc-skill-more">+{topSkills.length - 3}</span>
                )}
              </div>

              <div className="rc-footer">
                <span className="rc-footer-meta">
                  {[
                    candidate.years_experience != null ? `${candidate.years_experience} yrs exp` : null,
                    candidate.seniority_level,
                  ].filter(Boolean).join(' · ')}
                </span>
                <span className="rc-expand-hint">
                  {isExpanded ? '↑ collapse' : '↓ expand'}
                </span>
              </div>

              <input
                type="checkbox"
                className="rc-checkbox"
                checked={selected}
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

      {expandedCandidate && (() => {
        const candidate = expandedCandidate
        const score = activeScore(candidate)
        const tier = scoreTier(score)
        const displayScore = toTenScale(score)
        const candidateStrengths = Array.isArray(candidate.strengths) && candidate.strengths.length > 0
          ? candidate.strengths
          : Array.isArray(candidate.achievements)
            ? candidate.achievements.slice(0, 3)
            : []
        const candidateConsiderations = Array.isArray(candidate.considerations) ? candidate.considerations : []
        const experienceEntries = Array.isArray(candidate.experience) ? candidate.experience.slice(0, 2) : []
        const topSkills = Array.isArray(candidate.top_skills) ? candidate.top_skills : parseSkills(candidate.skills).slice(0, 6)
        const initials = String(candidate?.name || '')
          .split(' ')
          .map((part) => part[0] || '')
          .join('')
          .slice(0, 2)
          .toUpperCase()

        return (
          <div id="detail-drawer" className="detail-drawer">
            <div className="dd-header">
              <div className="dd-avatar">{initials || 'NA'}</div>
              <div className="dd-header-info">
                <div className="dd-name">{toDisplayText(candidate.name)}</div>
                <div className="dd-subtitle">
                  {[candidate.current_title, candidate.current_company, candidate.location].filter(Boolean).join(' · ')}
                </div>
              </div>
              {displayScore != null && (
                <div className={`dd-score dd-score--${tier}`}>
                  {displayScore}<span>/10</span>
                </div>
              )}
              <div className="dd-header-actions">
                <button className="dd-btn-primary" type="button">Schedule Interview</button>
                <button className="dd-btn-ghost" type="button" onClick={() => addCandidateToShortlist(candidate)}>Add to Shortlist</button>
                <button
                  className="dd-btn-ghost"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    window.location.href = `/candidates/${candidate.id}`
                  }}
                >
                  View full profile →
                </button>
              </div>
              <button className="dd-close" type="button" onClick={() => setExpandedId(null)}>✕</button>
            </div>

            <div className="dd-body">
              <div className="dd-col">
                <div className="dd-col-label">Summary</div>
                <p className="dd-summary">{toDisplayText(candidate.summary, 'No summary available')}</p>

                <div className="dd-col-label dd-col-label--mt-16">Key facts</div>
                <div className="dd-facts">
                  {candidate.years_experience != null && (
                    <div className="dd-fact">
                      <span className="dd-fact-k">Experience</span>
                      <span className="dd-fact-v">{candidate.years_experience} years</span>
                    </div>
                  )}
                  {candidate.seniority_level && (
                    <div className="dd-fact">
                      <span className="dd-fact-k">Seniority</span>
                      <span className="dd-fact-v">{candidate.seniority_level}</span>
                    </div>
                  )}
                  {candidate.email && (
                    <div className="dd-fact">
                      <span className="dd-fact-k">Email</span>
                      <a href={`mailto:${candidate.email}`} className="dd-fact-link">{candidate.email}</a>
                    </div>
                  )}
                </div>

                <div className="dd-col-label dd-col-label--mt-16">Recent experience</div>
                {experienceEntries.map((job, idx) => (
                  <div className="dd-job" key={`${candidate._bulkKey}-job-${idx}`}>
                    <div className="dd-job-title">{job.title}</div>
                    <div className="dd-job-meta">
                      {job.company} · {job.durationText || [job.startDate, job.endDate].filter(Boolean).join(' – ')}
                    </div>
                  </div>
                ))}
              </div>

              <div className="dd-col">
                <div className="dd-col-label">Strengths</div>
                <div className="dd-analysis-box dd-analysis-box--green">
                  {candidateStrengths.length > 0
                    ? candidateStrengths.map((strength, idx) => (
                      <div className="dd-analysis-item" key={`${candidate._bulkKey}-strength-${idx}`}>{strength}</div>
                    ))
                    : <div className="dd-analysis-empty">Re-analyse to generate AI strengths</div>}
                </div>

                <div className="dd-col-label dd-col-label--mt-14">Considerations</div>
                <div className="dd-analysis-box dd-analysis-box--amber">
                  {candidateConsiderations.length > 0
                    ? candidateConsiderations.map((consideration, idx) => (
                      <div className="dd-analysis-item" key={`${candidate._bulkKey}-consideration-${idx}`}>{consideration}</div>
                    ))
                    : (
                      <div className="dd-analysis-item">
                        {candidate.years_experience == null
                          ? 'Experience duration could not be determined — verify dates in resume'
                          : candidate.years_experience < 3
                            ? 'Early-career candidate — assess growth trajectory in interview'
                            : 'Run re-analysis to generate detailed AI considerations'}
                      </div>
                    )}
                </div>
              </div>

              <div className="dd-col">
                <div className="dd-col-label">Top skills</div>
                <div className="dd-top-skills">
                  {topSkills.map((skill) => (
                    <span className="dd-top-skill" key={`${candidate._bulkKey}-top-${String(formatSkillLabel(skill))}`}>
                      {formatSkillLabel(skill)}
                    </span>
                  ))}
                </div>

                {candidate.skills_structured && (
                  <>
                    {Object.entries({
                      Tools: candidate.skills_structured.tools_and_platforms,
                      Methods: candidate.skills_structured.methodologies,
                      Domain: candidate.skills_structured.domain_expertise,
                    }).map(([category, skills]) => skills?.length > 0 && (
                      <div key={`${candidate._bulkKey}-${category}`} className="dd-skill-group">
                        <div className="dd-skill-cat">{category}</div>
                        <div className="dd-skill-row">
                          {skills.slice(0, 6).map((skill) => (
                            <span className="dd-skill-pill" key={`${candidate._bulkKey}-${category}-${String(formatSkillLabel(skill))}`}>
                              {formatSkillLabel(skill)}
                            </span>
                          ))}
                          {skills.length > 6 && (
                            <span className="dd-skill-more">+{skills.length - 6}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {visibleCandidates.length === 0 && (
        <div className="candidate-results-page__empty-note">
          No candidates match the current filters.
        </div>
      )}

      <div className="pagination">
        <button className="touch-target page-btn" type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <span className="page-info">Page {pagination.page} of {pagination.totalPages}</span>
        <button className="touch-target page-btn" type="button" disabled={!pagination.hasNextPage} onClick={() => setPage((current) => current + 1)}>Next</button>
        <select className="touch-target page-size-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
          <option value={10}>10 / page</option>
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
        </select>
      </div>
    </div>
  )
}
