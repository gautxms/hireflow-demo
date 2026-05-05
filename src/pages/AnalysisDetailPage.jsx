import React, { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import CandidateResults from '../components/CandidateResults'
import '../styles/analyses.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const POLL_MS = 2500

function normalizeStatus(status) {
  const normalizedStatus = String(status || 'pending').trim().toLowerCase()
  const STATUS_ALIAS_MAP = {
    queued: 'pending',
    retrying: 'processing',
  }
  return STATUS_ALIAS_MAP[normalizedStatus] || normalizedStatus
}

function deriveDisplayStatus(analysis) {
  const summary = analysis?.summary || {}
  const total = Number(summary.total || 0)
  const complete = Number(summary.complete || 0)
  const failed = Number(summary.failed || 0)
  const processing = Number(summary.processing || 0)
  const pending = Number(summary.pending || 0)

  if (complete > 0 && failed > 0) return 'partial'
  if (total > 0 && complete === total && failed === 0) return 'complete'
  if (total > 0 && failed === total) return 'failed'
  if (processing > 0) return 'processing'
  if (pending > 0) return 'pending'

  return normalizeStatus(analysis?.liveStatus || analysis?.status)
}

function toCandidateResultsPayload(analysis) {
  const normalizeString = (value, fallback = '') => {
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return fallback
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return fallback
  }

  const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => normalizeString(item, '').trim())
      .filter(Boolean)
  }

  const normalizeObjectArray = (value) => {
    if (!Array.isArray(value)) return []
    return value.filter((item) => item && typeof item === 'object')
  }

  const normalizeBoundedScore = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0
    return Math.max(0, Math.min(100, numeric))
  }

  const normalizeCandidateForResults = (raw, index) => {
    if (!raw || typeof raw !== 'object') return null

    const id = normalizeString(raw?.id || raw?.resumeId || raw?.resume_id || `candidate-${index}`, `candidate-${index}`)
    const name = normalizeString(raw?.name || raw?.full_name || raw?.candidate_name || 'Candidate', 'Candidate')

    return {
      ...raw,
      id,
      name,
      title: normalizeString(raw?.title, ''),
      location: normalizeString(raw?.location, ''),
      summary: normalizeString(raw?.summary, ''),
      matchScore: normalizeBoundedScore(raw?.matchScore ?? raw?.score ?? 0),
      score: normalizeBoundedScore(raw?.score ?? raw?.matchScore ?? 0),
      resumeId: normalizeString(raw?.resumeId || raw?.resume_id, ''),
      filename: normalizeString(raw?.filename, ''),
      skills: Array.isArray(raw?.skills) || typeof raw?.skills === 'string' ? raw.skills : [],
      experience: normalizeObjectArray(raw?.experience),
      strengths: normalizeStringArray(raw?.strengths),
      considerations: normalizeStringArray(raw?.considerations),
      mustHaveSkills: normalizeStringArray(raw?.mustHaveSkills),
      niceToHaveSkills: normalizeStringArray(raw?.niceToHaveSkills),
      missingSkills: normalizeStringArray(raw?.missingSkills),
      assessment: {
        summary: '',
        highlights: [],
        risks: [],
        ...(raw?.assessment && typeof raw.assessment === 'object' ? raw.assessment : {}),
      },
      scoreBreakdown: {
        overall: normalizeBoundedScore(raw?.scoreBreakdown?.overall ?? raw?.score ?? raw?.matchScore ?? 0),
        categories: {},
        ...(raw?.scoreBreakdown && typeof raw.scoreBreakdown === 'object' ? raw.scoreBreakdown : {}),
      },
    }
  }

  const safeParseResult = (value) => {
    if (!value) return null
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    return typeof value === 'object' ? value : null
  }


  const collectCandidates = (value) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== 'object') return []

    const candidateBuckets = [
      value.candidates,
      value.results,
      value.output,
      value.data?.candidates,
      value.data?.results,
      value.payload?.candidates,
      value.payload?.results,
      value.response?.candidates,
    ]

    for (const bucket of candidateBuckets) {
      if (Array.isArray(bucket)) {
        return bucket
      }
    }

    return []
  }

  const items = Array.isArray(analysis?.items) ? analysis.items : []
  const directCandidates = Array.isArray(analysis?.candidates) ? analysis.candidates : []

  const itemCandidates = items.flatMap((item) => {
    const result = safeParseResult(item?.result)
    const candidates = collectCandidates(result)

    return candidates.map((candidate, index) => {
      try {
        const normalized = normalizeCandidateForResults(candidate, index)
        if (!normalized) return null
        return {
          ...normalized,
          id: normalized.id || `${item?.resumeId || item?.id || 'candidate'}-${index}`,
          resumeId: normalizeString(item?.resumeId || normalized?.resumeId, ''),
          filename: normalizeString(item?.filename || result?.filename || normalized?.filename, ''),
        }
      } catch {
        return null
      }
    }).filter(Boolean)
  })

  const rawCandidates = directCandidates.length > 0 ? directCandidates : itemCandidates
  const inputCount = rawCandidates.length
  const candidates = rawCandidates
    .map((candidate, index) => {
      try {
        return normalizeCandidateForResults(candidate, index)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      resumeId: normalizeString(candidate?.resumeId || candidate?.resume_id, ''),
      filename: normalizeString(candidate?.filename, ''),
    }))

  const outputCount = candidates.length
  const droppedCount = Math.max(0, inputCount - outputCount)
  const hasInvalidPayload = inputCount > 0 && outputCount === 0
  const hasPartiallyInvalidPayload = droppedCount > 0 && outputCount > 0

  const isProductionEnv = typeof window !== 'undefined' && window.location?.hostname && !['localhost', '127.0.0.1'].includes(window.location.hostname)
  if (droppedCount > 0 && !isProductionEnv) {
    console.warn('[AnalysisDetailPage] Candidate normalization dropped invalid records.', {
      droppedCount,
      inputCount,
      outputCount,
      analysisId: analysis?.id || '',
    })
  }

  return {
    candidates,
    droppedCount,
    inputCount,
    outputCount,
    hasInvalidPayload,
    hasPartiallyInvalidPayload,
    parseMeta: {
      ...(analysis?.parseMeta && typeof analysis.parseMeta === 'object' ? analysis.parseMeta : {}),
      hasJobDescription: Boolean(analysis?.jobDescriptionId || analysis?.jobDescriptionTitle),
      methodUsed: analysis?.parseMeta?.methodUsed || 'ai-extraction',
    },
  }
}

class ResultsErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="route-state-card" role="alert">
          <p>We could not render these results. Please return to Analyses or retry.</p>
          <a href="/analyses">← Back to analyses</a>
        </section>
      )
    }

    return this.props.children
  }
}

export default function AnalysisDetailPage({ pathname = '' }) {
  const analysisId = useMemo(() => {
    const parts = String(pathname || '').split('/').filter(Boolean)
    return parts.length >= 2 ? parts[1] : ''
  }, [pathname])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token || !analysisId) {
      setError('Invalid analysis session.')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let intervalId = null

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/analyses/${analysisId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load analysis details')
        }

        setAnalysis(payload)
        setError('')
      } catch (loadError) {
        if (loadError.name === 'AbortError') {
          return
        }
        setError(loadError.message || 'Unable to load analysis details')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    load()
    intervalId = window.setInterval(load, POLL_MS)

    return () => {
      controller.abort()
      if (intervalId) {
        window.clearInterval(intervalId)
      }
    }
  }, [analysisId])

  const summary = analysis?.summary || {}
  const displayStatus = deriveDisplayStatus(analysis)
  const candidateResultsPayload = useMemo(() => toCandidateResultsPayload(analysis), [analysis])
  const failedCount = Number(summary.failed || 0)

  if (loading || error || !analysis) {
    return (
      <main className="route-state">
        <section className="route-state-card">
          <a href="/analyses">← Back to analyses</a>
          <h1>Analysis {analysisId || '—'}</h1>
          {loading && <p>Loading analysis…</p>}
          {!loading && error && <p role="alert">{error}</p>}
        </section>
      </main>
    )
  }

  if ((displayStatus === 'complete' || displayStatus === 'completed' || displayStatus === 'partial' || displayStatus === 'failed') && candidateResultsPayload.candidates.length > 0) {
    return (
      <main className="analyses-layout">
        <section className="analyses-layout__content">
          <ResultsErrorBoundary>
            <CandidateResults
              candidates={candidateResultsPayload}
              onBack={() => {
                window.location.href = '/analyses'
              }}
            />
          </ResultsErrorBoundary>
        </section>
      </main>
    )
  }

  return (
    <main className="route-state">
      <section className="route-state-card">
        <a href="/analyses">← Back to analyses</a>
        <h1>Analysis {analysisId || '—'}</h1>
        <p>Current status: <strong>{displayStatus}</strong></p>
        {displayStatus === 'failed' ? (
          <p role="alert">This analysis failed before results were finalized. Please re-run the analysis or check the source files.</p>
        ) : (
          <p>This analysis is still processing. Results will be available when processing completes.</p>
        )}
        <p>Summary — Total {summary.total || 0} · Complete {summary.complete || 0} · Failed {failedCount} · Processing {summary.processing || 0} · Pending {summary.pending || 0}</p>
      </section>
    </main>
  )
}
