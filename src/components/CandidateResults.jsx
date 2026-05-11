import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import ShortlistManager from './ShortlistManager'
import BulkActions from './BulkActions'
import CandidateFilters from './CandidateFilters'
import {
  hasRenderableCandidates,
  normalizeCandidateForResults,
  normalizeNumericRange,
  normalizeSortBy,
  paginateCandidates,
  resolveActiveCandidateScore,
  resolveCandidateKey,
  resolveCandidateResumeUuid,
  toDisplayText,
} from './candidateResultsState'
import { applyOptimisticTagUpdate } from './candidateTagState'
import API_BASE from '../config/api'
import { FEATURE_KEYS, isFeatureEnabled } from '../config/featureFlags'
import {
  computeAllVisibleSelected,
  getSelectedCandidates,
  pruneSelection,
  toggleSelectAllVisible,
  toggleSelection,
} from './candidateSelectionState'
import '../styles/candidate-results.css'
import { normalizeCandidateResultsPayload } from './candidateResultsPayload'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function safeSerialize(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return '[object]'
  }
}


function parseSkills(skills) {
  if (Array.isArray(skills)) {
    return skills
      .map((skill) => (typeof skill === 'object' && skill !== null
        ? skill.name || skill.label || safeSerialize(skill)
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
    return skill.name || skill.label || safeSerialize(skill)
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


function resolveCandidateExperience(candidate = {}) {
  const total = Number(candidate?.totalExperienceYears)
  if (Number.isFinite(total)) return total
  const legacy = Number(candidate?.years_experience ?? candidate?.experience_years)
  if (Number.isFinite(legacy)) return legacy
  return parseYears(candidate?.experience)
}

function deriveExperienceEntries(candidate) {
  if (Array.isArray(candidate?.experience) && candidate.experience.length > 0) {
    return candidate.experience.slice(0, 2)
  }

  const structuredHighlights = Array.isArray(candidate?.highlights?.experience) ? candidate.highlights.experience : []
  if (structuredHighlights.length > 0) {
    return structuredHighlights.slice(0, 2).map((entry) => (typeof entry === 'string' ? { title: entry } : entry))
  }

  if (typeof candidate?.experience === 'string' && candidate.experience.trim()) {
    return [{ title: candidate.experience.trim() }]
  }

  return []
}

function deriveTopSkills(candidate) {
  if (Array.isArray(candidate?.top_skills) && candidate.top_skills.length > 0) {
    return parseSkills(candidate.top_skills)
  }

  if (candidate?.skills_structured) {
    const structured = candidate.skills_structured
    const aggregated = [
      ...(Array.isArray(structured.tools_and_platforms) ? structured.tools_and_platforms : []),
      ...(Array.isArray(structured.methodologies) ? structured.methodologies : []),
      ...(Array.isArray(structured.domain_expertise) ? structured.domain_expertise : []),
      ...(Array.isArray(structured.soft_skills) ? structured.soft_skills : []),
    ]
    if (aggregated.length > 0) {
      return parseSkills(aggregated)
    }
  }

  return parseSkills(candidate?.skills)
}

function ensureTextList(values, fallback) {
  const normalized = Array.isArray(values) ? values.map((entry) => toDisplayText(entry, '')).filter(Boolean) : []
  return normalized.length > 0 ? normalized : [fallback]
}

function normalizeEvidenceList(values) {
  if (!Array.isArray(values)) {
    return []
  }

  return values
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = toDisplayText(entry, '').trim()
        return text ? { quote: text, section: '', span: '' } : null
      }

      if (!entry || typeof entry !== 'object') {
        return null
      }

      const quote = toDisplayText(entry.quote || entry.snippet || entry.text, '').trim()
      const section = toDisplayText(entry.section || entry.resumeSection, '').trim()
      const span = toDisplayText(entry.span || entry.resumeSpan, '').trim()
      if (!quote && !section && !span) {
        return null
      }
      return { quote, section, span }
    })
    .filter(Boolean)
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

function deriveCompactRationale(candidate) {
  const reason = String(candidate?.matchScore?.reason || '').trim()
  if (reason) return reason
  return 'General profile score based on experience depth, skill breadth, and career progression.'
}



function normalizeComparableText(value) {
  return toDisplayText(value, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[•\-–—]/g, ' ')
    .trim()
}

function dedupeTextItems(items, blocked = []) {
  const blockedSet = new Set(blocked.map(normalizeComparableText).filter(Boolean))
  const seen = new Set()
  return (Array.isArray(items) ? items : [])
    .map((item) => toDisplayText(item, '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = normalizeComparableText(item)
      if (!key || seen.has(key) || blockedSet.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}

function resolveResumeDisplayFilename(candidate) {
  const preferred = [
    candidate?.sourceFilename,
    candidate?.originalFilename,
    candidate?.original_filename,
    candidate?.resume_filename,
    candidate?.filename,
  ]
    .map((value) => toDisplayText(value, '').trim())
    .find(Boolean)

  return preferred || 'Resume file'
}

function resolveResumeFileType(candidate) {
  const rawType = toDisplayText(candidate?.file_type || candidate?.fileType || candidate?.mime_type || candidate?.mimeType, '').trim()
  if (!rawType) return 'Unknown file type'
  if (rawType === 'application/pdf') return 'PDF'
  if (rawType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'DOCX'
  return rawType
}
function activeScore(candidate) {
  const resolved = resolveActiveCandidateScore(candidate)
  const fallbackScore = (
    candidate?.matchScore?.score
    ?? candidate?.matchScore
    ?? candidate?.score
    ?? candidate?.profile_score
    ?? candidate?.scoreBreakdown?.overall
    ?? 0
  )

  const numeric = Number(resolved ?? fallbackScore)
  return Number.isFinite(numeric) ? numeric : 0
}

function resolveAnalysisTitle(parseMeta, candidates) {
  const parseMetaCandidates = [
    parseMeta?.analysisName,
    parseMeta?.analysisTitle,
    parseMeta?.analysisLabel,
  ]

  const firstCandidate = Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : null
  const candidateFields = [
    firstCandidate?.analysisName,
    firstCandidate?.analysisTitle,
    firstCandidate?.analysis_name,
  ]

  const resolved = [...parseMetaCandidates, ...candidateFields]
    .map((value) => String(value || '').trim())
    .find(Boolean)

  return resolved || 'Analysis Results'
}

function resolveJobDescriptionSubtitle(parseMeta, candidates) {
  const parseMetaCandidates = [
    parseMeta?.jobDescriptionTitle,
    parseMeta?.jobTitle,
    parseMeta?.jobDescriptionName,
  ]

  const firstCandidate = Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : null
  const candidateFields = [
    firstCandidate?.jobDescriptionTitle,
    firstCandidate?.job_title,
  ]

  return [...parseMetaCandidates, ...candidateFields]
    .map((value) => String(value || '').trim())
    .find(Boolean)
}

function filterAndSortCandidates(candidates, filters) {
  const {
    searchText = '',
    selectedSkills = [],
    expRange = { min: '', max: '' },
    sortBy = 'best_match',
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

    const years = resolveCandidateExperience(candidate)
    if (String(expRange?.unknownOnly) === 'true') {
      if (candidate?.totalExperienceYears != null || candidate?.years_experience != null || candidate?.experience_years != null) return false
    }

    if (expMin !== null && years < expMin) {
      return false
    }

    if (expMax !== null && years > expMax) {
      return false
    }

    return true
  })

  return [...filtered].sort((a, b) => {
    if (sortBy === 'name_asc') {
      return String(a?.name || '').localeCompare(String(b?.name || ''))
    }

    if (sortBy === 'experience_desc') {
      return resolveCandidateExperience(b) - resolveCandidateExperience(a)
    }

    return Number(activeScore(b) || 0) - Number(activeScore(a) || 0)
  })
}


export default function CandidateResults({ candidates: candidatePayload, onBack, isLoading = false, isSharedLoading = false, loadingProgress = 0, userProfile = null }) {
  const [searchText, setSearchText] = useState('')
  const [selectedSkills, setSelectedSkills] = useState([])
  const [expRange, setExpRange] = useState({ min: '0', max: '50', bucket: 'all', unknownOnly: 'false' })
  const [sortBy, setSortBy] = useState('best_match')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [resultsError, setResultsError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [deletedIds, setDeletedIds] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [shortlistOpen, setShortlistOpen] = useState(false)
  const [resumeViewerCandidate, setResumeViewerCandidate] = useState(null)

  useEffect(() => {
    if (!resumeViewerCandidate) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setResumeViewerCandidate(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [resumeViewerCandidate])

  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [shortlistDetails, setShortlistDetails] = useState(null)
  const [shortlistSort, setShortlistSort] = useState('rating_desc')
  const [shortlistLoading, setShortlistLoading] = useState(false)
  const [shortlistError, setShortlistError] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [candidateTags, setCandidateTags] = useState({})
  const shortlistV2Enabled = isFeatureEnabled(FEATURE_KEYS.shortlistV2, { userProfile })

  const normalizedPayload = useMemo(() => normalizeCandidateResultsPayload(candidatePayload), [candidatePayload])
  const { candidates: rawCandidates, parseMeta, isInvalid: hasInvalidPayload } = normalizedPayload
  const [hasJobDescription, setHasJobDescription] = useState(Boolean(parseMeta?.hasJobDescription))

  const [liveCandidates, setLiveCandidates] = useState(rawCandidates)

  useEffect(() => {
    setLiveCandidates(rawCandidates)
  }, [rawCandidates])
  useEffect(() => {
    setHasJobDescription(Boolean(parseMeta?.hasJobDescription))
  }, [parseMeta])

  useEffect(() => {
    if (hasInvalidPayload) {
      console.error('[CandidateResults] Invalid payload shape. Expected { candidates: Candidate[], parseMeta?: object }.', candidatePayload)
    }
  }, [candidatePayload, hasInvalidPayload])

  const displayCandidates = liveCandidates.length > 0 ? liveCandidates : null
  const analysisTitle = useMemo(() => resolveAnalysisTitle(parseMeta, liveCandidates), [liveCandidates, parseMeta])
  const jobDescriptionSubtitle = useMemo(() => resolveJobDescriptionSubtitle(parseMeta, liveCandidates), [liveCandidates, parseMeta])

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
    if (!shortlistV2Enabled) {
      return
    }

    loadShortlists()
  }, [loadShortlists, shortlistV2Enabled])

  useEffect(() => {
    if (!shortlistV2Enabled || !selectedShortlistId) {
      return
    }

    loadShortlistDetails(selectedShortlistId)
  }, [loadShortlistDetails, selectedShortlistId, shortlistV2Enabled])
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
          sortOrder: normalizeSortBy(sortBy) === 'name_asc' ? 'asc' : 'desc',
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


  const addToShortlist = async (selected) => {
    if (selected.length === 0) {
      return
    }

    try {
      if (!shortlistV2Enabled) {
        let fallbackSuccessCount = 0
        for (const candidate of selected) {
          // Preserve legacy single-candidate shortlist flow when v2 is disabled.
          const ok = await addCandidateToShortlist(candidate)
          if (ok) {
            fallbackSuccessCount += 1
          }
        }

        if (fallbackSuccessCount > 0) {
          alert(`Added ${fallbackSuccessCount} candidate(s) to shortlist.`)
        }
        return
      }

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

  const skeletonCards = Array.from({ length: 3 }, (_, index) => `candidate-skeleton-${index}`)
  const expandedCandidate = useMemo(() => {
    if (!expandedId) return null
    return visibleCandidates.find((candidate, index) => resolveCandidateKey(candidate, index) === expandedId) || null
  }, [expandedId, visibleCandidates])

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
            <ChevronLeft size={14} aria-hidden="true" />
            Back
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
            <ChevronLeft size={14} aria-hidden="true" />
            Back
          </button>
          <h1 className="candidate-results-page__state-title candidate-results-page__state-title--compact">
            {analysisTitle}
          </h1>
          <p className="candidate-results-page__state-copy">
            {hasInvalidPayload
              ? 'We could not read the results payload. Please retry from Analyses or upload resumes again.'
              : 'Please upload resumes before viewing analysis.'}
          </p>
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
          <ChevronLeft size={14} aria-hidden="true" />
          Back
        </button>
        <div className="candidate-results-page__header-main">
          <h1 className="candidate-results-page__state-title candidate-results-page__state-title--compact">
            {analysisTitle}
          </h1>
          <p className="candidate-results-page__state-copy">
            {jobDescriptionSubtitle || (hasJobDescription ? 'Job description' : 'No job description')}
          </p>
          <p className="candidate-results-page__state-copy">
            {hasJobDescription ? `${pagination.total} ranked candidates` : `${pagination.total} analyzed candidates`}
          </p>
        </div>
        {resultsError && <p className="candidate-results-page__error">{resultsError}</p>}
      </div>

      <CandidateFilters
        shortlistEnabled={shortlistV2Enabled}
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

      {shortlistV2Enabled && shortlistOpen && (
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
          <button className="touch-target bulk-btn" onClick={() => addToShortlist(selectedCandidates)} type="button">⭐ Add to Shortlist</button>
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
        {visibleCandidates.map((candidate, index) => {
          const score = activeScore(candidate)
          const tier = scoreTier(score)
          const displayScore = toTenScale(score)
          const candidateKey = resolveCandidateKey(candidate, index)
          const isExpanded = expandedId === candidateKey
          const initials = String(candidate?.name || '')
            .split(' ')
            .map((part) => part[0] || '')
            .join('')
            .slice(0, 2)
            .toUpperCase()
          const topSkills = deriveTopSkills(candidate)
          const compactRationale = deriveCompactRationale(candidate)
          const selected = selectedIds.includes(candidate._bulkKey)

          return (
            <div
              key={candidate._bulkKey}
              className={`result-card result-card--${tier}${isExpanded ? ' result-card--open' : ''}`}
              onClick={() => handleCardClick(candidateKey)}
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

              <div className="rc-rationale" title={compactRationale}>
                {compactRationale}
              </div>

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
                    (candidate.experienceLabel || (resolveCandidateExperience(candidate) ? `${resolveCandidateExperience(candidate)} yrs exp` : null)),
                    candidate.seniority_level,
                  ].filter(Boolean).join(' · ')}
                </span>
                <span className="rc-expand-hint" role="button" aria-label={isExpanded ? 'Collapse candidate details' : 'Expand candidate details'}>
                  {isExpanded ? 'Collapse details' : 'Expand details'}
                </span>
              </div>

              <label className="rc-checkbox-wrap" onClick={(event) => event.stopPropagation()}>
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
              </label>
            </div>
          )
        })}
      </div>

      {expandedCandidate && (() => {
        const candidate = expandedCandidate
        const score = activeScore(candidate)
        const tier = scoreTier(score)
        const displayScore = toTenScale(score)
        const normalizeTextList = (list) => (Array.isArray(list) ? list.map((entry) => toDisplayText(entry, '')).filter(Boolean) : [])
        const candidateStrengths = dedupeTextItems(Array.isArray(candidate.strengths) && candidate.strengths.length > 0
          ? normalizeTextList(candidate.strengths)
          : Array.isArray(candidate.achievements)
            ? normalizeTextList(candidate.achievements).slice(0, 3)
            : [])
        const candidateConsiderations = dedupeTextItems(normalizeTextList(candidate.considerations))
        const reasoningText = toDisplayText(candidate?.matchScore?.reason || candidate?.fit_assessment?.reason, 'Reasoning unavailable for this profile.')
        const matchedSkills = dedupeTextItems(ensureTextList(candidate?.matchedSkills || candidate?.matched_skills, 'No confirmed matched skills were detected.'))
        const missingSkills = dedupeTextItems(ensureTextList(candidate?.missingSkills || candidate?.missing_skills, 'No explicit skill gaps were detected.'), matchedSkills)
        const evidenceObjects = normalizeEvidenceList(candidate?.evidence || candidate?.evidence_snippets || candidate?.highlights?.achievements)
        const evidenceItems = evidenceObjects.length > 0 ? evidenceObjects : [{ quote: 'No supporting evidence snippets are available.', section: '', span: '' }]
        const uncertaintyItems = candidateConsiderations.length > 0 ? candidateConsiderations : ['No uncertainty markers were provided. Re-run analysis for richer risk flags.']
        const nextActions = dedupeTextItems(ensureTextList(candidate?.next_action || candidate?.next_actions || candidate?.recommendation, 'Schedule a recruiter screen to validate fit and open questions.'))
        const resumeFilename = resolveResumeDisplayFilename(candidate)
        const resumeFileType = resolveResumeFileType(candidate)
        const candidateResumeId = resolveCandidateResumeUuid(candidate)
        const fullProfilePath = candidateResumeId ? `/candidates/${candidateResumeId}` : null
        const persistedTags = Array.isArray(candidate?.tags) ? candidate.tags : []
        const optimisticTags = candidateTags[candidate._bulkKey] || []
        const visibleTags = [...new Set([...persistedTags, ...optimisticTags].map((tag) => String(tag || '').trim()).filter(Boolean))]
        const initials = String(candidate?.name || '').split(' ').map((part) => part[0] || '').join('').slice(0, 2).toUpperCase()

        return (
          <div id="detail-drawer" className="detail-drawer">
            <div className="dd-header">
              <div className="dd-avatar">{initials || 'NA'}</div>
              <div className="dd-header-info"><div className="dd-name">{toDisplayText(candidate.name)}</div><div className="dd-subtitle">{[candidate.current_title, candidate.current_company, candidate.location].filter(Boolean).join(' · ')}</div></div>
              {displayScore != null && <div className={`dd-score dd-score--${tier}`}>{displayScore}<span>/10</span></div>}
              <div className="dd-header-actions">
                <button className="dd-btn-primary" type="button" onClick={() => addCandidateToShortlist(candidate)}>Add to Shortlist</button>
                <button className="dd-btn-ghost" type="button" onClick={() => setResumeViewerCandidate({ ...candidate, resumeFilename, resumeFileType, fullProfilePath })}>Open Resume</button>
              </div>
              <button className="dd-close" type="button" onClick={() => setExpandedId(null)}>✕</button>
            </div>
            <div className="dd-body">
              <div className="dd-col"><div className="dd-col-label">Decision summary</div><p className="dd-summary">{toDisplayText(candidate.summary, 'No summary available')}</p><div className="dd-col-label dd-col-label--mt-16">Recommended action</div><div className="dd-analysis-box dd-analysis-box--green">{nextActions.map((item, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-next-${idx}`}>{item}</div>)}</div><div className="dd-col-label dd-col-label--mt-16">Tags</div><div className="dd-top-skills">{visibleTags.length > 0 ? visibleTags.map((tag) => <span className="dd-top-skill" key={`${candidate._bulkKey}-tag-${tag}`}>{tag}</span>) : <span className="dd-skill-more">{candidateResumeId ? 'No tags added yet.' : 'Tags unavailable (missing resume ID).'}</span>}</div></div>
              <div className="dd-col"><div className="dd-col-label">Fit breakdown</div><div className="dd-analysis-box dd-analysis-box--green">{matchedSkills.map((item, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-matched-${idx}`}>{item}</div>)}</div><div className="dd-col-label dd-col-label--mt-14">Missing requirements</div><div className="dd-analysis-box dd-analysis-box--amber">{missingSkills.map((item, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-missing-${idx}`}>{item}</div>)}</div><div className="dd-col-label dd-col-label--mt-14">Resume file</div><div className="dd-analysis-box"><div className="dd-analysis-item"><strong>{resumeFilename}</strong></div><div className="dd-analysis-item">{resumeFileType}</div></div></div>
              <div className="dd-col"><details className="dd-details"><summary>Expandable AI details</summary><div className="dd-col-label dd-col-label--mt-14">Reasoning</div><p className="dd-summary">{reasoningText}</p><div className="dd-col-label dd-col-label--mt-14">Evidence</div><div className="dd-analysis-box">{evidenceItems.map((item, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-evidence-${idx}`}>{item.quote || 'Snippet unavailable'}</div>)}</div><div className="dd-col-label dd-col-label--mt-14">Strengths</div><div className="dd-analysis-box">{candidateStrengths.length > 0 ? candidateStrengths.map((strength, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-strength-${idx}`}>{strength}</div>) : <div className="dd-analysis-empty">Re-analyse to generate AI strengths</div>}</div><div className="dd-col-label dd-col-label--mt-14">Uncertainty</div><div className="dd-analysis-box dd-analysis-box--amber">{uncertaintyItems.map((item, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-uncertainty-${idx}`}>{item}</div>)}</div></details></div>
            </div>
          </div>
        )
      })()}

      {resumeViewerCandidate && (
        <div className="resume-modal-backdrop" role="dialog" aria-modal="true" aria-label="Resume viewer" onClick={() => setResumeViewerCandidate(null)}>
          <div className="resume-modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="resume-modal-header"><div><div className="dd-name">{toDisplayText(resumeViewerCandidate.name, 'Candidate')}</div><div className="dd-subtitle">{resumeViewerCandidate.resumeFilename} · {resumeViewerCandidate.resumeFileType}</div></div><button className="dd-close" type="button" onClick={() => setResumeViewerCandidate(null)}>✕</button></div>
            <div className="resume-modal-body"><p className="dd-summary">Preview unavailable in this view. Use the secure candidate profile page to review the full document.</p>{resumeViewerCandidate.fullProfilePath ? <a className="dd-btn-primary resume-modal-link" href={resumeViewerCandidate.fullProfilePath}>Open secure profile</a> : <div className="dd-analysis-empty">Resume ID not available for secure open.</div>}</div>
          </div>
        </div>
      )}

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
