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
  const [sortBy, setSortBy] = useState('name')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [resultsError, setResultsError] = useState('')
  const [jdOpen, setJdOpen] = useState(false)
  const [jdText, setJdText] = useState('')
  const [reanalysing, setReanalysing] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [deletedIds, setDeletedIds] = useState([])
  const [expandedId, setExpandedId] = useState(null)

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

  const fetchCandidates = useCallback(async () => {
    const collected = []
    let currentPage = 1
    let totalPages = 1

    while (currentPage <= totalPages) {
      const response = await fetch(`${API_BASE}/results?page=${currentPage}&pageSize=100`, {
        method: 'GET',
        headers: authHeaders(),
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to refresh candidates')
      }

      const pageCandidates = Array.isArray(payload.candidates) ? payload.candidates : []
      collected.push(...pageCandidates)
      totalPages = Math.max(1, Number(payload?.pagination?.totalPages) || 1)
      currentPage += 1
    }

    setLiveCandidates(collected)
    setHasJobDescription(collected.some((candidate) => candidate?.matchScore?.score != null))
  }, [authHeaders])

  const handleReanalyse = useCallback(async () => {
    try {
      setReanalysing(true)
      setResultsError('')
      const response = await fetch(`${API_BASE}/candidates/reanalyse`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ jobDescription: jdText }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to re-score candidates')
      }
      await fetchCandidates()
      setJdOpen(false)
    } catch (error) {
      console.error(error)
      setResultsError(error.message || 'Unable to re-score candidates')
    } finally {
      setReanalysing(false)
    }
  }, [authHeaders, fetchCandidates, jdText])

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
  const sortedCandidates = useMemo(() => (
    [...visibleCandidates].sort((a, b) => {
      const sA = a.matchScore?.score ?? a.profile_score ?? 0
      const sB = b.matchScore?.score ?? b.profile_score ?? 0
      return sB - sA
    })
  ), [visibleCandidates])

  const toggleCandidateSelection = (candidateKey) => {
    setSelectedIds((currentSelected) => toggleSelection(currentSelected, candidateKey))
  }

  const toggleSelectAllFiltered = () => {
    setSelectedIds((currentSelected) => toggleSelectAllVisible(currentSelected, visibleCandidates))
  }

  const handleCardClick = (id) => {
    setExpandedId((currentExpandedId) => (currentExpandedId === id ? null : id))
    setTimeout(() => {
      document.getElementById('candidate-detail')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 100)
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

      <div className="jd-panel">
        <button type="button" className="jd-toggle" onClick={() => setJdOpen((open) => !open)}>
          <span className="jd-toggle-chevron">{jdOpen ? '▲' : '▼'}</span>
          {jdText
            ? '✓ Job description active — candidates scored against this role'
            : 'Set job description for accurate role-fit scoring'}
        </button>

        {jdOpen && (
          <div className="jd-body">
            <textarea
              className="jd-textarea"
              placeholder="Paste the full job description here. AI will re-score every candidate against this specific role..."
              value={jdText}
              onChange={(event) => setJdText(event.target.value)}
              rows={7}
            />
            <div className="jd-footer">
              <button
                type="button"
                className="jd-btn-apply"
                onClick={handleReanalyse}
                disabled={!jdText.trim() || reanalysing}
              >
                {reanalysing ? 'Re-scoring candidates…' : 'Re-score all candidates against this role'}
              </button>
              {jdText && (
                <button
                  type="button"
                  className="jd-btn-clear"
                  onClick={() => {
                    setJdText('')
                    setJdOpen(false)
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

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
          const score = candidate.matchScore?.score ?? candidate.profile_score
          const isExpanded = expandedId === candidate.id
          const scoreColor = score >= 80 ? '#c8ff00' : score >= 60 ? '#7ab3f7' : score != null ? '#ffa500' : '#333333'
          const scoreGrad = score >= 80
            ? 'linear-gradient(90deg,#c8ff00,#39ff9f)'
            : score >= 60
              ? '#7ab3f7'
              : '#ffa500'
          const fitLabel = score >= 80 ? 'Strong match' : score >= 60 ? 'Good match' : score != null ? 'Possible match' : 'Not scored'
          const initials = String(candidate?.name || '')
            .split(' ')
            .map((part) => part[0] || '')
            .join('')
            .slice(0, 2)
            .toUpperCase()
          const topSkills = (candidate.top_skills || candidate.skills || [])
          const selected = selectedIds.includes(candidate._bulkKey)

          return (
            <div
              key={candidate._bulkKey}
              className={`result-card${isExpanded ? ' result-card--active' : ''}`}
              onClick={() => handleCardClick(candidate.id)}
            >
              <div className="rc-rank">#{index + 1}</div>
              <div className="rc-avatar" style={{ borderColor: `${scoreColor}40` }}>
                {initials || 'NA'}
              </div>
              <div className="rc-name">{toDisplayText(candidate.name)}</div>
              <div className="rc-role">
                {[candidate.current_title, candidate.years_experience ? `${candidate.years_experience}y` : null].filter(Boolean).join(' · ')}
              </div>
              <div className="rc-location">{candidate.location || 'Location unavailable'}</div>
              <div className="rc-score" style={{ color: scoreColor }}>
                {score != null ? `${score}%` : '—'}
              </div>
              <div className="rc-score-track">
                <div className="rc-score-fill" style={{
                  width: `${score ?? 0}%`,
                  background: score != null ? scoreGrad : '#1e1e1e',
                }}
                />
              </div>
              <div className="rc-fit" style={{ color: scoreColor }}>{fitLabel}</div>
              <div className="rc-skills">
                {topSkills.slice(0, 3).map((skill) => (
                  <span className="rc-skill-tag" key={`${candidate._bulkKey}-${String(formatSkillLabel(skill))}`}>
                    {formatSkillLabel(skill)}
                  </span>
                ))}
              </div>
              <div className="rc-expand-hint">
                {isExpanded ? 'Click to collapse ↑' : 'Click to expand ↓'}
              </div>
              <input
                type="checkbox"
                className="rc-check"
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
        const score = candidate.matchScore?.score ?? candidate.profile_score
        const scoreColor = score >= 80 ? '#c8ff00' : score >= 60 ? '#7ab3f7' : '#ffa500'
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
          <div id="candidate-detail" className="detail-drawer">
            <div className="dd-header">
              <div className="dd-avatar">{initials || 'NA'}</div>
              <div className="dd-header-info">
                <div className="dd-name">{toDisplayText(candidate.name)}</div>
                <div className="dd-subtitle">
                  {[candidate.current_title, candidate.current_company, candidate.location].filter(Boolean).join(' · ')}
                </div>
              </div>
              {score != null && (
                <div className="dd-score-badge" style={{ color: scoreColor }}>
                  {score}%
                </div>
              )}
              <div className="dd-actions">
                <button className="dd-btn-primary" type="button">Schedule Interview</button>
                <button className="dd-btn-ghost" type="button" onClick={() => addCandidateToShortlist(candidate)}>Add to Shortlist</button>
              </div>
              <button className="dd-close" type="button" onClick={() => setExpandedId(null)}>✕</button>
            </div>

            <div className="dd-body">
              <div className="dd-col">
                <div className="dd-section-label">Summary</div>
                <p className="dd-summary">{toDisplayText(candidate.summary, 'No summary available')}</p>

                <div className="dd-facts">
                  {candidate.years_experience != null && (
                    <div className="dd-fact">
                      <span className="dd-fact-label">Experience</span>
                      <span className="dd-fact-val">{candidate.years_experience} years</span>
                    </div>
                  )}
                  {candidate.seniority_level && (
                    <div className="dd-fact">
                      <span className="dd-fact-label">Seniority</span>
                      <span className="dd-fact-val">{candidate.seniority_level}</span>
                    </div>
                  )}
                  {candidate.email && (
                    <div className="dd-fact">
                      <span className="dd-fact-label">Email</span>
                      <a href={`mailto:${candidate.email}`} className="dd-fact-link">{candidate.email}</a>
                    </div>
                  )}
                </div>

                <div className="dd-section-label dd-section-label--spaced">Recent experience</div>
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
                <div className="dd-section-label">Strengths</div>
                <div className="dd-analysis-box dd-strengths">
                  {candidateStrengths.length > 0
                    ? candidateStrengths.map((strength, idx) => (
                      <div className="dd-analysis-item" key={`${candidate._bulkKey}-strength-${idx}`}>{strength}</div>
                    ))
                    : <div className="dd-analysis-empty">Re-analyse to generate AI strengths</div>}
                </div>

                <div className="dd-section-label dd-section-label--considerations">Considerations</div>
                <div className="dd-analysis-box dd-considerations">
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
                <div className="dd-section-label">Top skills</div>
                <div className="dd-top-skills">
                  {topSkills.map((skill) => (
                    <span className="dd-top-skill-tag" key={`${candidate._bulkKey}-top-${String(formatSkillLabel(skill))}`}>
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

                <button
                  className="dd-view-full"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    window.location.href = `/candidates/${candidate.id}`
                  }}
                >
                  View full profile →
                </button>
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
    </div>
  )
}
