import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, ChevronLeft, CircleHelp, ExternalLink, FileText, Mail, Minus, Plus, Share2, Star, Tag, Trash2, TriangleAlert, Upload, BriefcaseBusiness, MapPin, TrendingUp, X } from 'lucide-react'
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
  resolveActiveCandidateScore,
  resolveCandidateKey,
  resolveCandidateResumeUuid,
  sanitizeExpandedCandidate,
  toDisplayText,
  buildExpandedCandidateDrawerViewModel,
  resolveScoreBreakdownMetric,
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
import { logResultsRenderError } from '../pages/resultsErrorBoundaryTelemetry'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'


class CandidateDetailErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[CandidateDetailErrorBoundary] candidate detail drawer render crash.', {
      analysisId: this.props.analysisId,
      candidateCount: this.props.candidateCount,
      selectedCandidateKey: this.props.selectedCandidateKey,
      selectedCandidateId: this.props.selectedCandidateId,
      renderException: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || '',
      },
      componentStack: errorInfo?.componentStack || '',
    })

    logResultsRenderError({
      analysisId: this.props.analysisId,
      candidateCount: this.props.candidateCount,
      normalizationStats: this.props.normalizationStats,
      candidatePayloadShape: this.props.candidatePayloadShape,
      candidateFieldTypeSummary: this.props.candidateFieldTypeSummary,
      selectedCandidateKey: this.props.selectedCandidateKey,
      selectedCandidateId: this.props.selectedCandidateId,
      selectedCandidate: this.props.selectedCandidate,
      error,
      errorInfo,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div id="detail-drawer" className="detail-drawer" role="status" aria-live="polite">
          <div className="dd-body">
            <div className="dd-col">
              <p className="dd-summary">This candidate details payload is incompatible. Try another candidate.</p>
              <div className="candidate-results-page__state-actions">
                <button className="touch-target page-btn" type="button" onClick={this.props.onBackToResults}>Back to Results</button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function shouldTruncateTextByLineBudget(text, lineLimit, approxCharsPerLine = 95) {
  const content = String(text || '').trim()
  if (!content) return false
  const estimatedLines = content
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.trim().length / approxCharsPerLine)), 0)
  return estimatedLines > lineLimit
}

function ExpandableText({ text, className = 'dd-summary', clampClassName = 'dd-summary--clamp', buttonLabel = 'Read more', collapseLabel = 'Show less', lineLimit = 5, resetKey = '', controlsId = '' }) {
  const [expanded, setExpanded] = useState(false)
  const content = String(text || '').trim()
  const needsTruncation = shouldTruncateTextByLineBudget(content, lineLimit)
  useEffect(() => {
    setExpanded(false)
  }, [resetKey])
  return (
    <>
      <p id={controlsId || undefined} className={`${className}${!expanded && needsTruncation ? ` ${clampClassName}` : ''}`}>{content}</p>
      {needsTruncation && (
        <button type="button" className="dd-inline-disclosure" aria-expanded={expanded} aria-controls={controlsId || undefined} onClick={() => setExpanded((value) => !value)}>
          {expanded ? collapseLabel : buttonLabel}
        </button>
      )}
    </>
  )
}

function DrawerSection({ title, badge = null, className = '', children }) {
  return (
    <section className={`dd-section-card${className ? ` ${className}` : ''}`}>
      <div className="dd-col-label section-heading">{title}{badge}</div>
      {children}
    </section>
  )
}

function ExpandableList({ items, previewCount, renderItem, emptyState = null, listClassName = '', resetKey = '', controlsId = '' }) {
  const [expanded, setExpanded] = useState(false)
  const visibleItems = expanded ? items : items.slice(0, previewCount)
  const hasMore = items.length > previewCount
  useEffect(() => {
    setExpanded(false)
  }, [resetKey])

  return (
    <>
      <div id={controlsId || undefined} className={listClassName}>
        {items.length > 0 ? visibleItems.map(renderItem) : emptyState}
      </div>
      {hasMore && (
        <button className="dd-inline-disclosure" type="button" aria-expanded={expanded} aria-controls={controlsId || undefined} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}


function safeSerialize(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return '[object]'
  }
}

function hasRenderableContent(value) {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.some((entry) => hasRenderableContent(entry))
  if (typeof value === 'object') return Object.values(value).some((entry) => hasRenderableContent(entry))
  return Boolean(value)
}

function safeText(value, fallback = 'Unavailable') {
  if (value == null) return fallback
  if (typeof value === 'string') return value.trim() || fallback
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback
  return fallback
}

function safeArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter((entry) => hasRenderableContent(entry))
}

function formatScore(score) {
  const numeric = Number(score)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  const normalized = numeric > 10 ? numeric / 10 : numeric
  return Math.max(0, Math.min(10, normalized)).toFixed(1)
}

function getScoreTone(score) {
  const numeric = Number(score)
  if (!Number.isFinite(numeric) || numeric < 0) return 'unscored'
  const normalized = numeric > 10 ? numeric / 10 : numeric
  if (normalized >= 8) return 'strong'
  if (normalized >= 6) return 'possible'
  return 'low'
}

function getMatchLabel(score, explicitLabel = '') {
  const tone = getScoreTone(score)
  const cleanLabel = safeText(explicitLabel, '')
  if (cleanLabel) return cleanLabel
  if (tone === 'strong') return 'Strong match'
  if (tone === 'possible') return 'Possible match'
  if (tone === 'low') return 'Low match'
  return 'Unable to score'
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


function deriveExperienceEntries(candidate) {
  const entries = safeArray(candidate?.experience)
  if (entries.length === 0) return []

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      return {
        title: safeText(entry.title || entry.role, ''),
        company: safeText(entry.company || entry.organization, ''),
        startDate: safeText(entry.startDate || entry.start, ''),
        endDate: safeText(entry.endDate || entry.end, ''),
        durationText: safeText(entry.duration || entry.period, ''),
      }
    })
    .filter(Boolean)
}

function formatSkillLabel(skill) {
  if (typeof skill === 'object' && skill !== null) {
    return skill.name || skill.label || safeSerialize(skill)
  }

  return skill
}



function buildSkillGapItems(candidate) {
  const merged = new Map()

  const addItems = (items, sourceType) => {
    if (!Array.isArray(items)) return
    items.forEach((item) => {
      const label = toDisplayText(item, '').trim()
      if (!label) return
      const key = normalizeSkillKey(label)
      if (!key) return

      const existing = merged.get(key)
      if (existing) {
        if (sourceType === 'must-have') {
          existing.type = 'must-have'
        }
        return
      }

      merged.set(key, {
        label,
        type: sourceType,
      })
    })
  }

  addItems(candidate?.missingSkills, 'nice-to-have')
  addItems(candidate?.mustHaveSkills, 'must-have')
  addItems(candidate?.fit_assessment?.missing, 'nice-to-have')

  return Array.from(merged.values())
}
function parseYears(experience) {
  if (typeof experience === 'number' && Number.isFinite(experience)) {
    return experience
  }

  const match = String(experience || '').match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
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

function deriveAllSkills(candidate) {
  const deduped = new Map()
  const addSkills = (skills) => {
    parseSkills(skills).forEach((skill) => {
      const label = safeText(formatSkillLabel(skill), '').trim()
      if (!label) return
      const key = normalizeSkillKey(label)
      if (!key || deduped.has(key)) return
      deduped.set(key, label)
    })
  }

  addSkills(candidate?.top_skills)
  addSkills(candidate?.skills)
  if (candidate?.skills_structured) {
    const structured = candidate.skills_structured
    addSkills(structured.tools_and_platforms)
    addSkills(structured.methodologies)
    addSkills(structured.domain_expertise)
    addSkills(structured.soft_skills)
  }

  return Array.from(deduped.values())
}

function parseUploadDate(candidate) {
  const value = candidate?.uploadDate || candidate?.uploadedAt || candidate?.created_at || candidate?.createdAt
  const timestamp = Date.parse(String(value || ''))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function deriveCompactRationale(candidate) {
  const reason = resolveMatchScoreReason(candidate)
  if (reason) return reason
  return 'General profile score based on experience depth, skill breadth, and career progression.'
}

function resolveMatchScoreReason(candidate) {
  return String(candidate?.matchScore?.reason || candidate?.fit_assessment?.reason || '').trim()
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
  return Number.isFinite(numeric) ? numeric : null
}



function resolveVerdictLabel(candidate, tier, hasScore) {
  const explicitVerdict = [candidate?.fit_assessment?.verdict, candidate?.match_label, candidate?.matchLabel]
    .map((value) => String(value || '').trim())
    .find(Boolean)
  if (explicitVerdict) return explicitVerdict
  if (!hasScore) return 'Unable to score'
  if (tier === 'strong') return 'Strong match'
  if (tier === 'possible') return 'Possible match'
  return 'Low match'
}

function resolveConfidenceLabel(candidate, hasScore) {
  const explicitConfidence = [candidate?.fit_assessment?.confidence, candidate?.confidence, candidate?.match_confidence]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean)
  if (explicitConfidence) return explicitConfidence
  const numericConfidence = Number(candidate?.confidenceScores?.fit_assessment)
  if (Number.isFinite(numericConfidence)) {
    if (numericConfidence >= 0.85) return 'High confidence'
    if (numericConfidence >= 0.65) return 'Moderate confidence'
    return 'Low confidence'
  }
  return hasScore ? '' : 'Low confidence'
}

function formatEducation(education) {
  if (typeof education === 'string') return education.trim() || 'Unavailable'
  if (education && typeof education === 'object' && !Array.isArray(education)) {
    const formattedObject = [education?.degree, education?.school].filter(Boolean).join(', ')
    return formattedObject || safeText(education?.label || education?.name, 'Unavailable')
  }
  if (!Array.isArray(education) || education.length === 0) return 'Unavailable'
  const latest = education[0]
  if (typeof latest === 'string') return latest.trim() || 'Unavailable'
  if (latest && typeof latest === 'object') {
    return [latest?.degree, latest?.school].filter(Boolean).join(', ')
      || safeText(latest?.label || latest?.name, 'Unavailable')
  }
  return 'Unavailable'
}

function toHumanIssueLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.toLowerCase()
  if (normalized.includes('ocr') || normalized.includes('optical character recognition')) return 'OCR could not recover readable resume content.'
  if (normalized.includes('pdf') && (normalized.includes('unextract') || normalized.includes('extract'))) return 'PDF content was not extractable from this file.'
  if (normalized.includes('parse')) return 'Resume parsing was incomplete or failed.'
  if (normalized.includes('unable to score') || normalized.includes('cannot score') || normalized.includes('low confidence')) return 'Candidate could not be scored confidently from available resume content.'
  if (normalized.includes('corrupt') || normalized.includes('invalid pdf')) return 'Resume file appears corrupted or unreadable.'
  return raw
}

function deriveResumeIntegrityChecks(candidate, hasDisplayScore) {
  const existing = safeArray(candidate?.integrity_checks)
    .map((check) => {
      if (typeof check === 'string') {
        return { status: 'issue', label: toHumanIssueLabel(check) }
      }
      const label = toHumanIssueLabel(check?.label || check?.message || check?.issue || check?.detail || '')
      if (!label) return null
      return { status: check?.status === 'pass' ? 'pass' : 'issue', label }
    })
    .filter(Boolean)

  const issuePool = [
    candidate?.resume_processing_issue,
    candidate?.resume_processing_issues,
    candidate?.processing_issue,
    candidate?.processing_issues,
    candidate?.parse_error,
    candidate?.ocr_error,
    candidate?.error,
    candidate?.analysis_error,
    candidate?.failure_reason,
  ]

  const normalizedIssues = issuePool.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
    .map((entry) => toHumanIssueLabel(entry))
    .filter(Boolean)

  const checks = [...existing]
  normalizedIssues.forEach((label) => checks.push({ status: 'issue', label }))

  const asTextBlob = safeSerialize(candidate).toLowerCase()
  const mentionsUnextractable = asTextBlob.includes('unextractable') || asTextBlob.includes('not extractable')
  const mentionsOcrOrParseFailure = asTextBlob.includes('ocr') || asTextBlob.includes('parse')

  if (mentionsUnextractable && !checks.some((check) => check.label.toLowerCase().includes('extractable'))) {
    checks.push({ status: 'issue', label: 'PDF content was not extractable from this file.' })
  }
  if (mentionsOcrOrParseFailure && !checks.some((check) => check.label.toLowerCase().includes('pars') || check.label.toLowerCase().includes('ocr'))) {
    checks.push({ status: 'issue', label: 'Resume parsing was incomplete or failed.' })
  }
  if (!hasDisplayScore) {
    checks.push({ status: 'issue', label: 'Low confidence — candidate could not be scored from available content.' })
  }

  const deduped = []
  const seen = new Set()
  checks.forEach((check) => {
    const key = `${check.status}:${String(check.label || '').toLowerCase().trim()}`
    if (!check.label || seen.has(key)) return
    seen.add(key)
    deduped.push(check)
  })
  return deduped
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


export default function CandidateResults({ candidates: candidatePayload, onBack, isLoading = false, isSharedLoading = false, loadingProgress = 0, userProfile = null, analysisId = '', candidateCount = 0, normalizationStats = null, candidatePayloadShape = null, candidateFieldTypeSummary = [] }) {
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
  const [showAllDrawerSkills, setShowAllDrawerSkills] = useState(false)
  const [shortlistOpen, setShortlistOpen] = useState(false)


  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [shortlistDetails, setShortlistDetails] = useState(null)
  const [shortlistSort, setShortlistSort] = useState('rating_desc')
  const [shortlistLoading, setShortlistLoading] = useState(false)
  const [shortlistError, setShortlistError] = useState('')
  const [shortlistNotice, setShortlistNotice] = useState('')
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

  const displayCandidates = Array.isArray(liveCandidates) ? liveCandidates : []
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

  const openCandidateResumeInNewTab = useCallback(async (candidate) => {
    const resumeId = resolveCandidateResumeUuid(candidate)
    if (!resumeId) {
      return
    }

    try {
      const response = await fetch(`${API_BASE}/candidates/${encodeURIComponent(resumeId)}/resume`, {
        method: 'GET',
        headers: authHeaders(),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Unable to open candidate resume')
      }

      const fileBlob = await response.blob()
      const fileUrl = URL.createObjectURL(fileBlob)
      window.open(fileUrl, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(fileUrl), 30_000)
    } catch (error) {
      setResultsError(error.message || 'Unable to open candidate resume')
    }
  }, [authHeaders])

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

    try {
      return displayCandidates
        .map((candidate, index) => normalizeCandidateForResults(candidate, index))
        .filter((candidate) => candidate && candidate._isRenderable)
        .filter((candidate) => !deletedIds.includes(candidate._bulkKey))
    } catch (error) {
      logResultsRenderError({
        analysisId,
        candidateCount,
        normalizationStats,
        candidatePayloadShape,
        candidateFieldTypeSummary,
        error,
        errorInfo: { componentStack: 'CandidateResults:list-render' },
      })
      return []
    }
  }, [analysisId, candidateCount, candidateFieldTypeSummary, candidatePayloadShape, deletedIds, displayCandidates, normalizationStats])

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
    setShowAllDrawerSkills(false)
  }, [expandedId])

  useEffect(() => {
    setSelectedIds((current) => pruneSelection(current, filtered, resolveSelectionResumeId))
  }, [filtered])

  const selectedCandidates = getSelectedCandidates(filtered, selectedIds, resolveSelectionResumeId)
  const allFilteredSelected = computeAllVisibleSelected(visibleCandidates, selectedIds, resolveSelectionResumeId)

  const avgScore = filtered.length
    ? Math.round(filtered.reduce((sum, candidate) => sum + Number(activeScore(candidate) ?? 0), 0) / filtered.length)
    : 0
  const strongCount = filtered.filter((candidate) => activeScore(candidate) >= 80).length
  const sortedCandidates = useMemo(() => (
    [...visibleCandidates].sort((a, b) => {
      return (activeScore(b) ?? -1) - (activeScore(a) ?? -1)
    })
  ), [visibleCandidates])

  const toggleCandidateSelection = (candidate) => {
    const resumeId = resolveSelectionResumeId(candidate)
    if (!resumeId) return
    setSelectedIds((currentSelected) => toggleSelection(currentSelected, resumeId))
  }

  const toggleSelectAllFiltered = () => {
    setSelectedIds((currentSelected) => toggleSelectAllVisible(currentSelected, visibleCandidates, resolveSelectionResumeId))
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
      const requested = Number(payload?.summary?.requested || selected.length)

      if (succeeded > 0) {
        await Promise.all([
          loadShortlists(),
          loadShortlistDetails(selectedShortlistId),
        ])
      }

      if (failed > 0) {
        setShortlistError('')
        setShortlistNotice(`Shortlist updated: ${succeeded}/${requested} processed (${failed} failed).`)
      } else {
        setShortlistNotice(`Shortlist updated: ${succeeded}/${requested} processed.`)
      }
      if (succeeded > 0) {
        const succeededResumeIds = new Set(
          Array.isArray(payload?.outcomes)
            ? payload.outcomes.filter((item) => item?.ok).map((item) => String(item.resumeId || '').trim()).filter(Boolean)
            : [],
        )
        if (succeededResumeIds.size > 0) {
          setSelectedIds((current) => current.filter((id) => !succeededResumeIds.has(id)))
        } else if (failed === 0) {
          setSelectedIds([])
        }
      }
      alert(`Shortlist sync: ${added} added, ${updated} updated, ${failed} failed.`)
    } catch (error) {
      setShortlistError(error.message || 'Unable to add candidates to shortlist')
      setShortlistNotice('')
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
  const candidateByKey = useMemo(() => {
    const map = new Map()
    sortedCandidates.forEach((candidate, index) => {
      map.set(resolveCandidateKey(candidate, index), candidate)
    })
    return map
  }, [sortedCandidates])

  const expandedCandidate = useMemo(() => {
    if (!expandedId) return null
    return candidateByKey.get(expandedId) || null
  }, [candidateByKey, expandedId])

  const isExpandedCandidateMissing = Boolean(expandedId) && !expandedCandidate

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
              <button type="button" className="touch-target sp-close" onClick={() => setShortlistOpen(false)} aria-label="Close shortlist panel"><X size={18} strokeWidth={1.5} aria-hidden="true" /></button>
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
            {shortlistNotice ? <p className="shortlist-manager__muted-text">{shortlistNotice}</p> : null}
          </div>
        </>
      )}

      {selectedCandidates.length > 0 && (
        <BulkActions selectedCount={selectedCandidates.length}>
          <button className="touch-target bulk-btn" onClick={() => exportCSV(selectedCandidates)} type="button"><Upload size={18} strokeWidth={1.5} aria-hidden="true" />Export CSV</button>
          <button className="touch-target bulk-btn" onClick={() => emailForm(selectedCandidates)} type="button"><Mail size={18} strokeWidth={1.5} aria-hidden="true" />Export to Email</button>
          <button className="touch-target bulk-btn" onClick={() => addToShortlist(selectedCandidates)} type="button" disabled={shortlistV2Enabled && !selectedShortlistId}><Star size={18} strokeWidth={1.5} aria-hidden="true" />{shortlistV2Enabled && !selectedShortlistId ? 'Select shortlist first' : 'Add to shortlist'}</button>
          <button className="touch-target bulk-btn" onClick={() => sendFeedbackForm(selectedCandidates)} type="button"><Mail size={18} strokeWidth={1.5} aria-hidden="true" />Send Feedback</button>
          <button className="touch-target bulk-btn" onClick={createShareLink} type="button"><Share2 size={18} strokeWidth={1.5} aria-hidden="true" />Share View</button>
          <button className="touch-target bulk-btn danger" onClick={() => deleteSelected(selectedCandidates)} type="button"><Trash2 size={18} strokeWidth={1.5} aria-hidden="true" />Delete</button>
          <input
            className="touch-target candidate-results-page__tag-input"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            placeholder="tag1, tag2"
          />
          <button className="touch-target bulk-btn" onClick={() => mutateSelectedTags('add')} type="button"><Tag size={18} strokeWidth={1.5} aria-hidden="true" />Add Tags</button>
          <button className="touch-target bulk-btn" onClick={() => mutateSelectedTags('remove')} type="button"><Minus size={18} strokeWidth={1.5} aria-hidden="true" />Remove Tags</button>
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
          const tier = getScoreTone(score)
          const displayScore = formatScore(score)
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
          const selectionResumeId = resolveSelectionResumeId(candidate)
          const selected = Boolean(selectionResumeId) && selectedIds.includes(selectionResumeId)

          return (
            <div
              key={candidateKey}
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
                        {getMatchLabel(score)}
                      </div>
                    </>
                  ) : (
                    <div className="rc-score-empty">N/A</div>
                  )}
                </div>
              </div>

              <div className="rc-rationale" title={compactRationale}>
                {compactRationale}
              </div>

              <div className="rc-skills">
                {topSkills.slice(0, 3).map((skill) => (
                  <span className="rc-skill" key={`${candidateKey}-${String(formatSkillLabel(skill))}`}>
                    {formatSkillLabel(skill)}
                  </span>
                ))}
                {topSkills.length > 3 && (
                  <span className="rc-skill-more">+{topSkills.length - 3}</span>
                )}
                {topSkills.length === 0 && (
                  <span className="rc-skill-more">Relevant skills unavailable for this analysis</span>
                )}
              </div>

              <div className="rc-footer">
                <span className="rc-footer-meta">
                  {[
                    hasRenderableContent(candidate.years_experience) ? `${candidate.years_experience} yrs exp` : 'Experience unavailable',
                    safeText(candidate.seniority_level, 'Seniority unavailable'),
                  ].filter(Boolean).join(' · ')}
                </span>
                <span className="rc-expand-hint" aria-hidden="true">
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
                    toggleCandidateSelection(candidate)
                  }}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Select ${toDisplayText(candidate.name, 'candidate')}`}
                  disabled={!selectionResumeId}
                />
                <span className="rc-checkbox-label">{selectionResumeId ? 'Select' : 'Missing resume ID'}</span>
              </label>
            </div>
          )
        })}
      </div>

            {expandedCandidate && (() => {
  const detailVm = buildExpandedCandidateDrawerViewModel(expandedCandidate)
  const candidate = detailVm.candidate
  const expandedCandidateKey = detailVm.candidateKey
  const matchBreakdown = candidate?.matchScore?.breakdown || candidate?.scoreBreakdown
  const scoreBreakdownRows = [
    {
      label: 'Skill Match',
      value: resolveScoreBreakdownMetric(matchBreakdown, ['technical_skills', 'skills_match', 'skills', 'technicalSkills', 'skill_match_score'], candidate?.fit_assessment?.skill_match_score ?? null),
    },
    {
      label: 'Experience',
      value: resolveScoreBreakdownMetric(matchBreakdown, ['experience_years', 'experience', 'years_experience', 'experienceYears', 'experience_match_score'], candidate?.fit_assessment?.experience_match_score ?? null),
    },
    {
      label: 'Education',
      value: resolveScoreBreakdownMetric(matchBreakdown, ['education', 'education_match', 'academic_background', 'educationMatch', 'education_match_score'], candidate?.fit_assessment?.education_match_score ?? null),
    },
    {
      label: 'Role Alignment',
      value: resolveScoreBreakdownMetric(matchBreakdown, ['role_alignment', 'roleAlignment', 'role_fit', 'roleFit', 'job_alignment', 'methodologies'], candidate?.fit_assessment?.role_alignment ?? candidate?.fit_assessment?.roleAlignment ?? candidate?.fit_assessment?.role_fit ?? candidate?.fit_assessment?.roleFit ?? candidate?.fit_assessment?.job_alignment ?? null),
    },
  ]
  const resolvableScoreBreakdownRows = scoreBreakdownRows.filter((row) => Number.isFinite(row.value))
  const hasResolvableBreakdownMetrics = resolvableScoreBreakdownRows.length > 0
  const integrityChecks = deriveResumeIntegrityChecks(candidate, detailVm.hasDisplayScore)
  const hasResumeForOpen = Boolean(resolveCandidateResumeUuid(candidate))
  const keyFacts = [
    { label: 'Experience', value: detailVm.experienceYearsLabel },
    { label: 'Location', value: detailVm.locationLabel },
    { label: 'Seniority', value: detailVm.seniorityLabel },
    { label: 'Education', value: detailVm.educationLabel },
  ].filter((fact) => hasRenderableContent(fact.value) && !String(fact.value).toLowerCase().includes('unavailable'))
  const allSkillsVisible = showAllDrawerSkills ? detailVm.allSkills : detailVm.allSkills.slice(0, 16)
  const hasCollapsedSkills = detailVm.allSkills.length > allSkillsVisible.length

  return (
    <CandidateDetailErrorBoundary
      key={String(expandedCandidateKey || "candidate-detail")}
      analysisId={analysisId}
      candidateCount={candidateCount}
      normalizationStats={normalizationStats}
      candidatePayloadShape={candidatePayloadShape}
      candidateFieldTypeSummary={candidateFieldTypeSummary}
      selectedCandidateKey={expandedCandidateKey}
      selectedCandidateId={candidate.id}
      selectedCandidate={candidate}
      onBackToResults={() => setExpandedId(null)}
    >
      <div id="detail-drawer" className="detail-drawer">
        <div className="dd-header">
          <div className="dd-header-left">
            <div className="dd-avatar">{detailVm.initials || 'NA'}</div>
            <div className="dd-header-info">
              <div className="dd-name">{detailVm.candidateName}</div>
              <div className="dd-subtitle">{detailVm.candidateTitle}</div>
              <div className="dd-meta-facts">
                <span className="dd-meta-item"><BriefcaseBusiness size={18} strokeWidth={1.5} aria-hidden="true" />{detailVm.experienceLabel}</span>
                <span className="dd-meta-item"><MapPin size={18} strokeWidth={1.5} aria-hidden="true" />{detailVm.locationLabel}</span>
                <span className="dd-meta-item"><TrendingUp size={18} strokeWidth={1.5} aria-hidden="true" />{detailVm.seniorityLabel}</span>
              </div>
            </div>
          </div>
          <div className={`dd-score-panel dd-score-panel--${detailVm.scoreTier}`}>
            <div className="dd-score">
              {detailVm.hasDisplayScore ? detailVm.displayScore : '—'}<span>{detailVm.hasDisplayScore ? '/10' : ''}</span>
            </div>
            <div className={`dd-fit-label dd-fit--${detailVm.scoreTier}`}>{detailVm.verdictLabel}</div>
            {detailVm.confidenceLabel && <div className="dd-confidence">{detailVm.confidenceLabel}</div>}
          </div>
          <div className="dd-header-actions">
            <button className="hf-btn hf-btn--primary dd-btn-primary" type="button">Schedule interview</button>
            <button className="hf-btn hf-btn--secondary dd-btn-ghost" type="button" onClick={() => addCandidateToShortlist(candidate)}>Add to shortlist</button>
            <button className="hf-btn hf-btn--ghost hf-btn--icon dd-btn-ghost" type="button" onClick={(event) => { event.stopPropagation(); openCandidateResumeInNewTab(candidate) }}>
              <ExternalLink size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <button className="hf-btn hf-btn--ghost hf-btn--icon dd-close" type="button" onClick={() => setExpandedId(null)} aria-label="Close candidate details"><X size={18} strokeWidth={1.5} aria-hidden="true" /></button>
        </div>

        <div className="dd-body">
          <div className="dd-col">
            <DrawerSection title="Summary">
              <ExpandableText text={detailVm.summaryText} clampClassName="dd-summary--clamp-5" buttonLabel="Show more" collapseLabel="Show less" lineLimit={5} resetKey={expandedCandidateKey} controlsId={`summary-${expandedCandidateKey}`} />
            </DrawerSection>
            {detailVm.recommendationText && (
              <DrawerSection title="Recommended action" className="dd-section-card--compact">
                <ExpandableText text={detailVm.recommendationText} className="dd-recommended-action" clampClassName="dd-summary--clamp-5" buttonLabel="Show more" collapseLabel="Show less" lineLimit={5} resetKey={expandedCandidateKey} controlsId={`recommendation-${expandedCandidateKey}`} />
              </DrawerSection>
            )}
            {keyFacts.length > 0 && (
              <DrawerSection title="Key facts" className="dd-section-card--compact">
                <div className="dd-facts-grid">
                  {keyFacts.map((fact) => (
                    <div className="dd-fact-card" key={`${expandedCandidateKey}-fact-${fact.label}`}>
                      <span className="dd-fact-k">{fact.label}</span>
                      <span className="dd-fact-v">{fact.value}</span>
                    </div>
                  ))}
                </div>
              </DrawerSection>
            )}
            <DrawerSection title="AI reasoning" className="dd-section-card--compact">
              <ExpandableText text={detailVm.reasoningText} clampClassName="dd-summary--clamp-6" buttonLabel="Show more" collapseLabel="Show less" lineLimit={7} resetKey={expandedCandidateKey} controlsId={`reasoning-${expandedCandidateKey}`} />
            </DrawerSection>
            <DrawerSection title="View resume" className="dd-section-card--compact">
            <div className="dd-resume-file">
              <FileText size={16} strokeWidth={1.6} aria-hidden="true" />
              <div>
                <div className="dd-resume-filename">{detailVm.resumeFileLabel}</div>
                <div className="dd-resume-meta">
                  {hasResumeForOpen ? 'Open the uploaded resume in a new tab.' : 'Resume file is unavailable for this candidate.'}
                </div>
                <button
                  className="hf-btn hf-btn--secondary dd-btn-ghost dd-toggle-skills"
                  type="button"
                  onClick={() => openCandidateResumeInNewTab(candidate)}
                  disabled={!hasResumeForOpen}
                  aria-label={hasResumeForOpen ? `View resume for ${detailVm.candidateName}` : 'Resume unavailable'}
                >
                  <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span>View resume</span>
                </button>
              </div>
            </div>
            </DrawerSection>
          </div>
          <div className="dd-col">
            <DrawerSection title="Score breakdown">
            {hasResolvableBreakdownMetrics ? (
              <div className="dd-analysis-box dd-breakdown">
                {resolvableScoreBreakdownRows.map((row) => (
                  <div className="dd-breakdown-row" key={`${expandedCandidateKey}-breakdown-${row.label}`}>
                    <span>{row.label}</span><span className="dd-breakdown-track"><span className={`dd-breakdown-fill ${row.value >= 75 ? 'dd-breakdown-fill--strong' : row.value >= 50 ? 'dd-breakdown-fill--possible' : 'dd-breakdown-fill--low'}`} style={{ width: `${row.value}%` }} /></span><span>{row.value}%</span>
                  </div>
                ))}
              </div>
            ) : <p className="dd-summary">Score breakdown unavailable</p>}
            </DrawerSection>
            <DrawerSection title="Matched skills" className="dd-section-card--compact" badge={<span className="dd-count-badge dd-count-badge--lime">✓ {detailVm.matchedSkills.length} of {detailVm.totalSkills} required</span>}>
              <ExpandableList items={detailVm.matchedSkills} previewCount={6} resetKey={expandedCandidateKey} controlsId={`matched-skills-${expandedCandidateKey}`} listClassName="dd-top-skills" renderItem={(skill) => (<span className="dd-top-skill dd-top-skill--matched" key={`${expandedCandidateKey}-matched-${skill}`}>{skill}</span>)} />
            </DrawerSection>
            <DrawerSection title="Skill gaps" className="dd-section-card--compact" badge={detailVm.missingSkills.length > 0 ? <span className="dd-count-badge dd-count-badge--amber">{detailVm.missingSkills.length} gaps identified</span> : null}>
              {detailVm.missingSkills.length > 0 ? (
                <ExpandableList items={detailVm.missingSkills} previewCount={4} resetKey={expandedCandidateKey} controlsId={`skill-gaps-${expandedCandidateKey}`} listClassName="dd-top-skills" renderItem={(skill) => (
                  <span className="dd-top-skill dd-top-skill--warn" key={`${expandedCandidateKey}-gap-${skill}`}>{skill}</span>
                )} />
              ) : <p className="dd-summary">No explicit skill gaps identified.</p>}
            </DrawerSection>
            {detailVm.allSkills.length > 0 && (
              <DrawerSection title="All skills" className="dd-section-card--compact">
                <div id={`all-skills-${expandedCandidateKey}`} className="dd-top-skills dd-top-skills--all">
                  {allSkillsVisible.map((skill) => (
                    <span className="dd-top-skill dd-top-skill--all" key={`${expandedCandidateKey}-all-skill-${skill}`}>{skill}</span>
                  ))}
                </div>
                {hasCollapsedSkills && (
                  <button className="dd-inline-disclosure" type="button" aria-expanded={showAllDrawerSkills} aria-controls={`all-skills-${expandedCandidateKey}`} onClick={() => setShowAllDrawerSkills((current) => !current)}>
                    {showAllDrawerSkills ? 'Show less' : 'Show more'}
                  </button>
                )}
              </DrawerSection>
            )}
          </div>
          <div className="dd-col">
            <DrawerSection title="Strengths">
              <div className="dd-analysis-box dd-analysis-box--green">
                {detailVm.candidateStrengths.length > 0
                  ? (
                    <ExpandableList
                      items={detailVm.candidateStrengths}
                      previewCount={3}
                      resetKey={expandedCandidateKey}
                      controlsId={`strengths-${expandedCandidateKey}`}
                      listClassName="dd-list"
                      renderItem={(strength, idx) => (<div className="dd-list-item" key={`${expandedCandidateKey}-strength-${idx}`}><CheckCircle size={18} strokeWidth={1.5} /><span>{strength}</span></div>)}
                    />
                  )
                  : <div className="dd-analysis-empty">Re-analyse to generate AI strengths</div>}
              </div>
            </DrawerSection>
            <DrawerSection title="Considerations" className="dd-section-card--compact">
              <div className="dd-analysis-box dd-analysis-box--amber">
                {detailVm.candidateConsiderations.length > 0
                  ? (
                    <ExpandableList
                      items={detailVm.candidateConsiderations}
                      previewCount={3}
                      resetKey={expandedCandidateKey}
                      controlsId={`considerations-${expandedCandidateKey}`}
                      listClassName="dd-list"
                      renderItem={(consideration, idx) => (<div className="dd-list-item dd-list-item--warn" key={`${expandedCandidateKey}-consideration-${idx}`}><AlertTriangle size={18} strokeWidth={1.5} /><span>{consideration}</span></div>)}
                    />
                  )
                  : <div className="dd-analysis-item">Run re-analysis to generate detailed AI considerations</div>}
              </div>
            </DrawerSection>
            {integrityChecks.length > 0 && <div className="dd-analysis-box">{integrityChecks.map((check, idx) => (<div className={`dd-list-item ${check?.status === 'issue' ? 'dd-list-item--warn' : ''}`} key={`${expandedCandidateKey}-integrity-${idx}`}>{check?.status === 'issue' ? <AlertTriangle size={18} strokeWidth={1.5} /> : <CheckCircle size={18} strokeWidth={1.5} />}<span>{toDisplayText(check?.label || check, 'Unavailable')}</span></div>))}</div>}
          </div>
        </div>
      </div>
    </CandidateDetailErrorBoundary>
  )
})()}


      {isExpandedCandidateMissing && (
        <p className="candidate-results-page__empty-note" role="status">
          Candidate details are unavailable for this entry. Select another candidate from the list.
        </p>
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

function resolveSelectionResumeId(candidate) {
  return resolveCandidateResumeUuid(candidate)
}
