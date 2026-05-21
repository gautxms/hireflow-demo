import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import CandidateResults from '../components/CandidateResults'
import '../styles/analyses.css'
import { toCandidateResultsPayload } from './analysisDetailPayload.js'
import { validateAnalysisResultsPayload } from '../schemas/analysisResultsSchema.js'
import { logResultsPayloadCompatibilityIssues } from './resultsErrorBoundaryTelemetry.js'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const POLL_MS = 2500
const FRONTEND_BUILD_ID = import.meta.env.VITE_BUILD_ID || 'unknown'
const FRONTEND_COMMIT_HASH = import.meta.env.VITE_GIT_COMMIT_HASH || 'unknown'
const isNonProductionBuild = (() => {
  if (typeof process !== 'undefined' && process?.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location?.hostname)
})()

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


function shortenAnalysisId(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return '—'
  if (normalized.length <= 12) return normalized
  return `${normalized.slice(0, 8)}…${normalized.slice(-4)}`
}

function deriveAnalysisPageTitle(analysis, analysisId) {
  const preferred = [
    analysis?.name,
    analysis?.batchName,
    analysis?.batch?.name,
    shortenAnalysisId(analysis?.id || analysisId),
  ]

  return preferred.map((value) => String(value || '').trim()).find(Boolean) || 'Analysis'
}

function summarizeCandidateFieldTypes(candidates = [], sampleSize = 5) {
  if (!Array.isArray(candidates)) return []
  return candidates.slice(0, sampleSize).map((candidate, index) => ({
    index,
    id: String(candidate?.id || candidate?.resumeId || `candidate-${index}`),
    matchScoreType: candidate?.matchScore === null ? 'null' : typeof candidate?.matchScore,
    matchScoreScoreType: candidate?.matchScore?.score === null ? 'null' : typeof candidate?.matchScore?.score,
    matchScoreReasonType: candidate?.matchScore?.reason === null ? 'null' : typeof candidate?.matchScore?.reason,
    experienceType: candidate?.experience === null ? 'null' : Array.isArray(candidate?.experience) ? 'array' : typeof candidate?.experience,
  }))
}


export default function AnalysisDetailPage({ pathname = '', onPageTitleChange = null }) {
  const analysisId = useMemo(() => {
    const parts = String(pathname || '').split('/').filter(Boolean)
    return parts.length >= 2 ? parts[1] : ''
  }, [pathname])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState(null)

  useEffect(() => {
    console.info(
      `[BuildCorrelation] AnalysisDetailPage mounted | build_id=${FRONTEND_BUILD_ID} | commit=${FRONTEND_COMMIT_HASH} | analysis_id=${analysisId || 'unknown'}`,
    )
  }, [analysisId])

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
  const candidateResultsValidation = useMemo(() => {
    const rawPayload = toCandidateResultsPayload(analysis)
    const { payload, issues } = validateAnalysisResultsPayload(rawPayload)
    if (issues.length > 0 && isNonProductionBuild) {
      console.error('[AnalysisDetailPage] Candidate payload validation issues.', {
        analysisId: analysis?.id || '',
        issueCount: issues.length,
        issues,
      })
    }
    return { payload, issues }
  }, [analysis])
  const candidateResultsPayload = candidateResultsValidation.payload

  useEffect(() => {
    const issues = candidateResultsValidation?.issues || []
    if (issues.length === 0) return
    logResultsPayloadCompatibilityIssues({
      analysisId: analysis?.id || analysisId,
      issues,
      droppedCount: candidateResultsPayload?.droppedCount,
      inputCount: candidateResultsPayload?.inputCount,
      outputCount: candidateResultsPayload?.outputCount,
    })
  }, [analysis?.id, analysisId, candidateResultsPayload?.droppedCount, candidateResultsPayload?.inputCount, candidateResultsPayload?.outputCount, candidateResultsValidation])
  const itemCount = Array.isArray(analysis?.items) ? analysis.items.length : 0
  const candidateCount = candidateResultsPayload.candidates.length
  const hasCandidateResults = candidateResultsPayload.candidates.length > 0
  const failedCount = Number(summary.failed || 0)
  const pageTitle = useMemo(() => deriveAnalysisPageTitle(analysis, analysisId), [analysis, analysisId])

  useEffect(() => {
    if (typeof onPageTitleChange === 'function') {
      onPageTitleChange(pageTitle)
    }
  }, [onPageTitleChange, pageTitle])

  const candidatePayloadShape = useMemo(() => ({
    status: analysis?.status || '',
    liveStatus: analysis?.liveStatus || '',
    summary: analysis?.summary || {},
    candidateCount,
    itemCount,
    candidateSampleKeys: candidateResultsPayload?.candidates?.[0] && typeof candidateResultsPayload.candidates[0] === 'object'
      ? Object.keys(candidateResultsPayload.candidates[0]).slice(0, 20)
      : [],
  }), [analysis, candidateCount, candidateResultsPayload, itemCount])
  const candidateFieldTypeSummary = useMemo(
    () => summarizeCandidateFieldTypes(candidateResultsPayload?.candidates),
    [candidateResultsPayload],
  )

  useEffect(() => {
    if (isNonProductionBuild && (displayStatus === 'complete' || displayStatus === 'partial' || displayStatus === 'failed')) {
      console.info('[AnalysisDetailPage] Candidate results payload shape.', candidatePayloadShape)
    }
  }, [candidatePayloadShape, displayStatus])

  if (loading || error || !analysis) {
    return (
      <main className="route-state">
        <section className="route-state-card">
          <a href="/analyses">← Back to Analyses</a>
          <h1>Analysis {analysisId || '—'}</h1>
          {loading && <p>Loading analysis…</p>}
          {!loading && error && <p role="alert">{error}</p>}
        </section>
      </main>
    )
  }

  if (
  (displayStatus === 'complete' ||
    displayStatus === 'completed' ||
    displayStatus === 'partial' ||
    displayStatus === 'failed')
) {
  return (
    <main className="analyses-layout">
      <section className="analyses-layout__content">
        {isNonProductionBuild && candidateResultsPayload.droppedCount > 0 && (
          <section className="route-state-card" role="status" aria-live="polite">
            <p>
              Dev warning: dropped {candidateResultsPayload.droppedCount} of {candidateResultsPayload.inputCount} incoming candidates during normalization.
              Inspect logs for analysisId {analysisId || '—'}.
            </p>
          </section>
        )}
        {candidateResultsPayload.droppedCount > 0 && (
          <section className="route-state-card" role="status" aria-live="polite">
            <p>Some candidate details were sanitized for compatibility.</p>
          </section>
        )}

        <CandidateResults
          candidates={candidateResultsPayload}
          onBack={() => {
            window.location.assign('/analyses')
          }}
          analysisId={analysisId}
          candidateCount={hasCandidateResults ? candidateCount : 0}
          normalizationStats={{
            droppedCount: candidateResultsPayload.droppedCount,
            inputCount: candidateResultsPayload.inputCount,
            validCount: candidateResultsPayload.validCount,
          }}
          candidatePayloadShape={candidatePayloadShape}
          candidateFieldTypeSummary={candidateFieldTypeSummary}
        />
      </section>
    </main>
  )
}

  return (
    <main className="route-state">
      <section className="route-state-card">
        <a href="/analyses">← Back to Analyses</a>
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
