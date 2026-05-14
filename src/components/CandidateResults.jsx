import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, AlertCircle, BookmarkPlus, Briefcase, CalendarDays, Check, ChevronLeft, CircleHelp, Clock3, FileText, MapPin, X, GraduationCap } from 'lucide-react'
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
  resolveCandidateBasics,
  resolveCandidateKey,
  resolveCandidateEducationText,
  resolveCandidateResumeMetadata,
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
import { SCORE_BREAKDOWN_UNAVAILABLE_MESSAGE, resolveCandidateScoreBreakdown, resolveSkillSignals } from './candidateScoreSkillsResolver'
import { resolveCandidateReasoning, resolveCandidateVerdict, normalizeComparableTextKey } from './candidateDrawerTextResolver'
import { resolveResumeFileTypeLabel } from './resumeFileTypeResolver'

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


function formatExperienceDisplay(candidate = {}) {
  const basics = resolveCandidateBasics(candidate)
  const explicitYears = Number.isFinite(basics.experienceYears) ? basics.experienceYears : null
  const inferredYears = Number.isFinite(basics.estimatedExperienceYears) ? basics.estimatedExperienceYears : null
  const years = explicitYears ?? inferredYears

  if (years == null) {
    return 'Experience unavailable'
  }

  const isEstimated = Boolean(basics.isEstimatedExperience || candidate?.isEstimated)
  const sourceLabel = toDisplayText(basics.experienceSource || basics.experienceLabel, '').trim()

  if (isEstimated) {
    const provenanceText = sourceLabel ? ` (${sourceLabel})` : ''
    return `~${years.toFixed(1)} yrs (estimated${provenanceText})`
  }

  return `${years} yrs exp`
}

function resolveCandidateExperience(candidate = {}) {
  const basics = resolveCandidateBasics(candidate)
  return Number.isFinite(basics.experienceYears) ? basics.experienceYears : null
}

function resolveCandidateExperienceForSort(candidate = {}) {
  return resolveCandidateExperience(candidate) ?? 0
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





function resolveScoreConfidence(candidate = {}) {
  const hasExperience = Number.isFinite(resolveCandidateExperience(candidate))
  const skillSignals = resolveSkillSignals(candidate)
  const hasSkills = skillSignals.primarySkills.length > 0 || skillSignals.allSkills.length > 0
  const hasDomain = Boolean(toDisplayText(candidate?.domain || candidate?.industry || candidate?.domain_expertise, '').trim())

  const present = [hasExperience, hasSkills, hasDomain].filter(Boolean).length
  const missingFields = []
  if (!hasExperience) missingFields.push('experience')
  if (!hasSkills) missingFields.push('skills')
  if (!hasDomain) missingFields.push('domain context')

  if (present >= 3) return { level: 'high', label: 'High confidence', missingFields, low: false }
  if (present == 2) return { level: 'medium', label: 'Medium confidence', missingFields, low: false }
  return { level: 'low', label: 'Low confidence', missingFields, low: true }
}

const SCORE_RUBRIC_SUMMARY = 'Score weighted by experience, required skills, and domain match.'
const SCORE_FORMULA_TOOLTIP = 'Formula: Required skills (50%), experience alignment (30%), domain match (20%). Confidence drops when profile fields are missing.'

function dedupeTextItems(items, blocked = []) {
  const blockedSet = new Set(blocked.map(normalizeComparableTextKey).filter(Boolean))
  const seen = new Set()
  return (Array.isArray(items) ? items : [])
    .map((item) => toDisplayText(item, '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = normalizeComparableTextKey(item)
      if (!key || seen.has(key) || blockedSet.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}

function sanitizePillValues(items) {
  const seen = new Set()
  const normalized = Array.isArray(items) ? items : [items]

  return normalized
    .map((item) => String(formatSkillLabel(item) || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}


function formatResumeSize(candidate) {
  const rawSize = candidate?.file_size ?? candidate?.fileSize ?? candidate?.resume_size ?? candidate?.resumeSize
  const size = Number(rawSize)
  if (!Number.isFinite(size) || size <= 0) return null
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 ** 2)).toFixed(1)} MB`
}

function deriveDecisionVerdict(candidate, score) {
  const title = toDisplayText(candidate?.current_title, 'this candidate')
  const matchedSkills = dedupeTextItems(candidate?.matchedSkills || candidate?.matched_skills || [])
  const missingSkills = dedupeTextItems(candidate?.missingSkills || candidate?.missing_skills || [])

  if (score >= 80) {
    return `${title} shows strong fit signals. Proceed if priorities align with the role scope.`
  }
  if (score >= 60) {
    if (missingSkills.length > 0) {
      return `${title} is a potential fit with a few open skill gaps that need interview validation.`
    }
    return `${title} is a possible fit; validate depth and recency of relevant experience in screening.`
  }
  if (matchedSkills.length > 0) {
    return `${title} has limited fit against core requirements despite some relevant overlap.`
  }
  return `${title} has low demonstrated alignment with the core requirements in the current profile data.`
}

function deriveRecommendedAction(candidate, score) {
  const missingSkills = dedupeTextItems(candidate?.missingSkills || candidate?.missing_skills || [])
  const considerations = dedupeTextItems(candidate?.considerations || [])

  if (score >= 80 && missingSkills.length === 0 && considerations.length === 0) {
    return 'Move to panel interview and focus on role-specific impact examples.'
  }
  if (score >= 80) {
    return `Advance to recruiter screen and verify: ${[...missingSkills, ...considerations][0] || 'remaining uncertainties'}.`
  }
  if (score >= 60) {
    return `Run a targeted recruiter screen before advancing; confirm ${missingSkills[0] || considerations[0] || 'critical requirement coverage'}.`
  }
  return `Hold progression until core fit is validated; prioritize screening around ${missingSkills[0] || 'required role capabilities'}.`
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

    const years = resolveCandidateExperienceForSort(candidate)
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
      return resolveCandidateExperienceForSort(b) - resolveCandidateExperienceForSort(a)
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
  const [expandedSections, setExpandedSections] = useState({})
  const [shortlistOpen, setShortlistOpen] = useState(false)

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
  const toggleSectionExpanded = useCallback((candidateKey, sectionKey) => {
    const compoundKey = `${candidateKey}:${sectionKey}`
    setExpandedSections((current) => ({ ...current, [compoundKey]: !current[compoundKey] }))
  }, [])

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
              <button type="button" className="touch-target sp-close" onClick={() => setShortlistOpen(false)} aria-label="Close shortlists panel">
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
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
          const confidence = resolveScoreConfidence(candidate)
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
                      <div className={`rc-score-num${confidence.low ? ' rc-score-num--deemphasized' : ''}`}>
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
                      <div className={`rc-confidence rc-confidence--${confidence.level}`}>{confidence.label}</div>
                    </>
                  ) : (
                    <div className="rc-score-empty">Not scored</div>
                  )}
                </div>
              </div>

              <div className="rc-rationale" title={compactRationale}>
                {compactRationale}
              </div>
              <div className="rc-rubric">
                <span>{SCORE_RUBRIC_SUMMARY}</span>
                <span className="rc-score-help" title={SCORE_FORMULA_TOOLTIP} aria-label={SCORE_FORMULA_TOOLTIP}>ⓘ</span>
              </div>
              {confidence.low ? <div className="rc-confidence-flag">Low confidence due to missing {confidence.missingFields.join(', ')}.</div> : null}

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
                    (candidate.experienceLabel || formatExperienceDisplay(candidate)),
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
        const confidence = resolveScoreConfidence(candidate)
        const normalizeTextList = (list) => (Array.isArray(list) ? list.map((entry) => toDisplayText(entry, '')).filter(Boolean) : [])
        const candidateStrengths = dedupeTextItems(Array.isArray(candidate.strengths) && candidate.strengths.length > 0
          ? normalizeTextList(candidate.strengths)
          : Array.isArray(candidate.achievements)
            ? normalizeTextList(candidate.achievements).slice(0, 3)
            : []).slice(0, 3)
        const candidateConsiderations = dedupeTextItems(normalizeTextList(candidate.considerations))
        const verdictText = resolveCandidateVerdict(candidate)
        const reasoningText = resolveCandidateReasoning(candidate, verdictText)
        const scoreBreakdown = resolveCandidateScoreBreakdown(candidate)
        const skillSignals = resolveSkillSignals(candidate)
        const primarySkills = skillSignals.primarySkills.length > 0
          ? sanitizePillValues(skillSignals.primarySkills)
          : [skillSignals.hasExplicitMatched ? 'No confirmed matched skills were detected.' : 'Relevant skills unavailable for this analysis.']
        const missingSkills = skillSignals.skillGaps.length > 0
          ? sanitizePillValues(dedupeTextItems(skillSignals.skillGaps, primarySkills))
          : ['No explicit skill gaps were detected.']
        const allSkills = skillSignals.allSkills.length > 0 ? sanitizePillValues(dedupeTextItems(skillSignals.allSkills)) : ['No skills were extracted for this profile.']
        const evidenceObjects = normalizeEvidenceList(candidate?.evidence || candidate?.evidence_snippets || candidate?.highlights?.achievements)
        const evidenceItems = evidenceObjects.length > 0 ? evidenceObjects : [{ quote: 'No supporting evidence snippets are available.', section: '', span: '' }]
        const uncertaintyItems = (candidateConsiderations.length > 0 ? candidateConsiderations : ['No uncertainty markers were provided. Re-run analysis for richer risk flags.']).slice(0, 3)
        const integrityFlags = Array.isArray(candidate?.resumeIntegrityFlags) ? candidate.resumeIntegrityFlags : []
        const decisionVerdict = deriveDecisionVerdict(candidate, score)
        const recommendedAction = deriveRecommendedAction(candidate, score)
        const nextActions = ensureTextList(candidate?.next_steps || candidate?.recommended_actions, recommendedAction).slice(0, 3)
        const probePool = dedupeTextItems([
          ...candidateConsiderations,
          ...missingSkills,
          ...(Array.isArray(candidate?.questions) ? candidate.questions : []),
        ])
        const interviewProbes = probePool.slice(0, 3)
        const resumeFilename = resolveCandidateResumeMetadata(candidate).resumeFilename
        const resumeFileType = resolveResumeFileTypeLabel(candidate)
        const resumeFileSize = formatResumeSize(candidate)
        const candidateResumeId = resolveCandidateResumeUuid(candidate)
        const fullProfilePath = candidateResumeId ? `/candidates/${candidateResumeId}` : null
        const openResumePath = candidateResumeId ? `${API_BASE}/resumes/${candidateResumeId}/view` : null
        const persistedTags = Array.isArray(candidate?.tags) ? candidate.tags : []
        const optimisticTags = candidateTags[candidate._bulkKey] || []
        const visibleTags = [...new Set([...persistedTags, ...optimisticTags].map((tag) => String(tag || '').trim()).filter(Boolean))]
        const initials = String(candidate?.name || '').split(' ').map((part) => part[0] || '').join('').slice(0, 2).toUpperCase()
        const sectionStateKey = (sectionKey) => `${candidate._bulkKey}:${sectionKey}`
        const isSectionExpanded = (sectionKey) => Boolean(expandedSections[sectionStateKey(sectionKey)])
        const previewList = (items, sectionKey, limit = 4) => {
          const hasOverflow = items.length > limit
          const expanded = isSectionExpanded(sectionKey)
          return {
            items: expanded || !hasOverflow ? items : items.slice(0, limit),
            hasOverflow,
            expanded,
          }
        }
        const primarySkillsPreview = previewList(primarySkills, 'primary-skills', 5)
        const missingSkillsPreview = previewList(missingSkills, 'missing-skills', 4)
        const allSkillsPreview = previewList(allSkills, 'all-skills', 8)
        const uncertaintyPreview = previewList(uncertaintyItems, 'uncertainty', 3)
        const probesPreview = previewList(interviewProbes.length > 0 ? interviewProbes : ['No interview probes were extracted.'], 'uncertainty', 2)
        const evidencePreview = previewList(evidenceItems, 'evidence', 4)
        const keyFacts = [
          { label: 'Experience', value: formatExperienceDisplay(candidate) },
          { label: 'Seniority', value: toDisplayText(candidate.seniority || candidate.level || candidate.seniority_level, 'Unavailable') },
          { label: 'Education', value: toDisplayText(resolveCandidateEducationText(candidate), 'Unavailable') },
          { label: 'Location', value: toDisplayText(candidate.location, 'Unavailable') },
        ]

        return (
          <article id="detail-drawer" className="detail-drawer dd-card dd-card--target">
            <div className="dd-header">
              <div className="dd-header-identity">
                <div className="dd-avatar">{initials || 'NA'}</div>
                <div className="dd-header-info">
                  <div className="dd-name">{toDisplayText(candidate.name)}</div>
                  <div className="dd-meta-row">
                    <span className="dd-meta-pill"><Briefcase size={14} strokeWidth={1.5} aria-hidden="true" />{toDisplayText(candidate.current_title, 'Role unavailable')}</span>
                    <span className="dd-meta-pill"><Clock3 size={14} strokeWidth={1.5} aria-hidden="true" />{formatExperienceDisplay(candidate)}</span>
                    <span className="dd-meta-pill"><MapPin size={14} strokeWidth={1.5} aria-hidden="true" />{toDisplayText(candidate.location, 'Location unavailable')}</span>
                    <span className="dd-meta-pill"><GraduationCap size={14} strokeWidth={1.5} aria-hidden="true" />{toDisplayText(candidate.seniority || candidate.level || candidate.seniority_level, 'Seniority not specified')}</span>
                  </div>
                </div>
              </div>
              {displayScore != null && (
                <div className={`dd-score-block dd-score-block--${tier}`}>
                  <div className={`dd-score dd-score--${tier}${confidence.low ? ' dd-score--deemphasized' : ''}`}>
                    {displayScore}
                    <span>/10</span>
                  </div>
                  <div className={`dd-fit-label dd-fit-label--${tier}`}>
                    {tier === 'strong' ? 'Strong match' : tier === 'possible' ? 'Potential match' : 'Low match'}
                  </div>
                  <div className={`dd-confidence dd-confidence--${confidence.level}`}>{confidence.label}</div>
                  <div className="dd-rubric">
                    <span>{SCORE_RUBRIC_SUMMARY}</span>
                    <span className="dd-score-help" title={SCORE_FORMULA_TOOLTIP} aria-label={SCORE_FORMULA_TOOLTIP}>ⓘ</span>
                  </div>
                  {confidence.low ? <div className="dd-confidence-flag">Low confidence: missing {confidence.missingFields.join(', ')}.</div> : null}
                  <div className="dd-score-track" aria-hidden="true">
                    <span className={`dd-score-fill dd-score-fill--${tier}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
                  </div>
                </div>
              )}
              <div className="dd-header-actions" aria-label="Candidate actions">
                <div className="dd-action-group dd-action-group--positive" role="group" aria-label="Primary next steps">
                  <button className="dd-btn-primary" type="button" onClick={() => addCandidateToShortlist(candidate)}>
                    <BookmarkPlus size={15} strokeWidth={1.5} aria-hidden="true" />
                    Add to shortlist
                  </button>
                  {fullProfilePath ? <a className="dd-btn-secondary" href={fullProfilePath}><CalendarDays size={15} strokeWidth={1.5} aria-hidden="true" />Schedule interview</a> : <button className="dd-btn-secondary" type="button" disabled><CalendarDays size={15} strokeWidth={1.5} aria-hidden="true" />Schedule interview</button>}
                  {openResumePath ? <a className="dd-icon-btn" href={openResumePath} target="_blank" rel="noopener noreferrer" aria-label="Open resume" title="Open resume"><FileText size={16} strokeWidth={1.5} aria-hidden="true" /></a> : null}
                </div>
                <div className="dd-action-group dd-action-group--destructive" role="group" aria-label="Dismissive actions">
                  <button className="dd-btn-danger" type="button" disabled aria-label="Reject candidate" title="Reject candidate (coming soon)">
                    Reject
                  </button>
                  <button className="dd-close" type="button" onClick={() => setExpandedId(null)} aria-label="Close candidate details" title="Close candidate details">
                    <X size={16} strokeWidth={1.5} aria-hidden="true" />
                    <span>Close</span>
                  </button>
                </div>
              </div>
            </div>
            <section className="dd-body dd-body--target">
              <div className="dd-col dd-col--left dd-col--decision">
                <div className="dd-col-label">Verdict</div>
                <p className="dd-summary">{verdictText}</p>
                <div className="dd-col-label dd-col-label--mt-16">Why</div>
                <div className="dd-analysis-box">
                  <div className="dd-analysis-item">{reasoningText}</div>
                </div>
                <div className="dd-col-label dd-col-label--mt-16">Strengths</div>
                <div className="dd-analysis-box dd-analysis-box--green">
                  {candidateStrengths.length > 0
                    ? candidateStrengths.map((strength, idx) => <div className="dd-analysis-item dd-analysis-item--icon" key={`${candidate._bulkKey}-strength-${idx}`}><Check size={14} strokeWidth={1.5} aria-hidden="true" />{strength}</div>)
                    : <div className="dd-analysis-empty">Re-analyse to generate AI strengths</div>}
                </div>
                <div className="dd-col-label dd-col-label--mt-16">Gaps & uncertainties</div>
                <div className="dd-analysis-box dd-analysis-box--amber">
                  {uncertaintyPreview.items.map((item, idx) => <div className="dd-analysis-item dd-analysis-item--icon" key={`${candidate._bulkKey}-uncertainty-${idx}`}><AlertCircle size={14} strokeWidth={1.5} aria-hidden="true" />{item}</div>)}
                  {probesPreview.items.map((item, idx) => <div className="dd-analysis-item dd-probe-item" key={`${candidate._bulkKey}-probe-${idx}`}><CircleHelp size={14} strokeWidth={1.5} aria-hidden="true" />{item}</div>)}
                  {(uncertaintyPreview.hasOverflow || probesPreview.hasOverflow) ? <button type="button" className="dd-expand-btn" onClick={() => toggleSectionExpanded(candidate._bulkKey, 'uncertainty')}>{isSectionExpanded('uncertainty') ? 'Less' : 'More'}</button> : null}
                </div>
                <div className="dd-col-label dd-col-label--mt-16">Recruiter action</div>
                <div className="dd-analysis-box dd-analysis-box--green">
                  {nextActions.map((item, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-next-${idx}`}>{item}</div>)}
                </div>
                <div className="dd-col-label dd-col-label--mt-16">Key facts</div>
                <div className="dd-key-facts-grid">
                  {keyFacts.map((fact) => (
                    <div className="dd-key-fact-card" key={`${candidate._bulkKey}-fact-${fact.label}`}>
                      <div className="dd-key-fact-label">{fact.label}</div>
                      <div className="dd-key-fact-value">{fact.value}</div>
                    </div>
                  ))}
                </div>
                {visibleTags.length > 0 && (
                  <>
                    <div className="dd-col-label dd-col-label--mt-16">Tags</div>
                    <div className="dd-top-skills">
                      {visibleTags.map((tag) => <span className="dd-top-skill" key={`${candidate._bulkKey}-tag-${tag}`}>{tag}</span>)}
                    </div>
                  </>
                )}
              </div>

              <div className="dd-col dd-col--center dd-col--score-skills">
                <div className="dd-col-label">Score breakdown</div>
                <div className="dd-analysis-box dd-analysis-box--green">
                  {scoreBreakdown.isValid
                    ? scoreBreakdown.items.map((item, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-score-breakdown-${idx}`}>{item.label.replace('alignment', 'match')}: {item.value}%</div>)
                    : <div className="dd-analysis-empty">{SCORE_BREAKDOWN_UNAVAILABLE_MESSAGE}</div>}
                </div>
                <div className="dd-col-label dd-col-label--mt-14">{skillSignals.label}</div>
                <div className="dd-analysis-box dd-analysis-box--green">
                  {primarySkillsPreview.items.map((item, idx) => <span className="dd-top-skill" key={`${candidate._bulkKey}-primary-skill-${idx}`}>{item}</span>)}
                  {primarySkillsPreview.hasOverflow ? <button type="button" className="dd-expand-btn" onClick={() => toggleSectionExpanded(candidate._bulkKey, 'primary-skills')}>{primarySkillsPreview.expanded ? 'Less' : 'More'}</button> : null}
                </div>
                <div className="dd-col-label dd-col-label--mt-14">Missing requirements</div>
                <div className="dd-analysis-box dd-analysis-box--amber">
                  {missingSkillsPreview.items.map((item, idx) => <span className="dd-skill-pill dd-skill-pill--gap" key={`${candidate._bulkKey}-missing-${idx}`}>{item}</span>)}
                  {missingSkillsPreview.hasOverflow ? <button type="button" className="dd-expand-btn" onClick={() => toggleSectionExpanded(candidate._bulkKey, 'missing-skills')}>{missingSkillsPreview.expanded ? 'Less' : 'More'}</button> : null}
                </div>
                <div className="dd-col-label dd-col-label--mt-14">All skills (reference)</div>
                <div className="dd-analysis-box">
                  {allSkillsPreview.items.map((item, idx) => <span className="dd-skill-pill" key={`${candidate._bulkKey}-all-skills-${idx}`}>{item}</span>)}
                  {allSkillsPreview.hasOverflow ? <button type="button" className="dd-expand-btn" onClick={() => toggleSectionExpanded(candidate._bulkKey, 'all-skills')}>{allSkillsPreview.expanded ? 'Less' : 'More'}</button> : null}
                </div>
              </div>

              <div className="dd-col dd-col--right dd-col--analysis">
                <div className="dd-col-label">Resume evidence</div>
                <div className="dd-analysis-box">
                  {evidencePreview.items.map((item, idx) => <div className="dd-analysis-item" key={`${candidate._bulkKey}-evidence-${idx}`}>{item.quote || 'Snippet unavailable'}</div>)}
                  {evidencePreview.hasOverflow ? <button type="button" className="dd-expand-btn" onClick={() => toggleSectionExpanded(candidate._bulkKey, 'evidence')}>{evidencePreview.expanded ? 'Less' : 'More'}</button> : null}
                </div>
                <div className="dd-col-label dd-col-label--mt-14">Resume integrity checks</div>
                <div className="dd-analysis-box dd-analysis-box--amber">
                  {integrityFlags.length > 0
                    ? integrityFlags.map((flag, idx) => (
                      <div className="dd-analysis-item dd-analysis-item--icon" key={`${candidate._bulkKey}-integrity-${idx}`}>
                        <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
                        {toDisplayText(flag.label, 'Potential issue')}: {toDisplayText(flag.evidence, 'Needs recruiter review')}
                      </div>
                    ))
                    : <div className="dd-analysis-empty">No resume integrity concerns detected. Continue with normal recruiter review.</div>}
                </div>
                <div className="dd-col-label dd-col-label--mt-14">Resume file</div>
                <div className="dd-analysis-box">
                  <div className="dd-analysis-item dd-analysis-item--icon"><FileText size={14} strokeWidth={1.5} aria-hidden="true" /><strong>{resumeFilename}</strong></div>
                  <div className="dd-analysis-item">{resumeFileType}{resumeFileSize ? ` · ${resumeFileSize}` : ''}{openResumePath ? <><span> · </span><a href={openResumePath} target="_blank" rel="noopener noreferrer">Open resume</a></> : ''}</div>
                </div>
              </div>
            </section>
          </article>
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
