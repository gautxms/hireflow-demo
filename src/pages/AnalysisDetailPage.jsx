import { useEffect, useMemo, useRef, useState } from 'react'
import API_BASE from '../config/api'
import CandidateResults from '../components/CandidateResults'
import '../styles/analyses.css'
import { toCandidateResultsPayload } from './analysisDetailPayload.js'
import { validateAnalysisResultsPayload } from '../schemas/analysisResultsSchema.js'
import { buildResumeFileIdentity, toSafeResumeFailureReason } from '../utils/resumeFileIdentity.js'
import {
  logResultsFallbackToLastKnownGood,
  logResultsPayloadCompatibilityIssues,
} from './resultsErrorBoundaryTelemetry.js'

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


function formatAnalysisProgressMessage(summary = {}) {
  const total = Number(summary.total || 0)
  const complete = Number(summary.complete || 0)
  const failed = Number(summary.failed || 0)

  if (complete > 0 && failed > 0) {
    return `Partial results: ${complete} of ${total} resumes were analysed. ${failed} file${failed === 1 ? '' : 's'} could not be processed.`
  }

  if (total > 0 && failed === total) {
    return `No resumes were analysed. ${failed} file${failed === 1 ? '' : 's'} could not be processed.`
  }

  return ''
}

function FailedFilesSection({ items = [], title = 'Failed files' }) {
  const failedItems = (Array.isArray(items) ? items : []).filter((item) => String(item?.status || '').toLowerCase() === 'failed' || item?.error)
  if (failedItems.length === 0) return null

  return (
    <section className="analysis-failed-files" role="status" aria-live="polite">
      <h2>{title}</h2>
      <p>Review the failed file below, then upload a corrected DOCX, TXT, or text-based PDF.</p>
      <ul className="analysis-failed-files__list">
        {failedItems.map((item, index) => {
          const identity = buildResumeFileIdentity(item)
          return (
            <li key={`${item?.resumeId || item?.itemId || item?.id || identity.filename}-${index}`} className="analysis-failed-files__item">
              <div className="analysis-failed-files__header">
                <span className="analysis-failed-files__name">{identity.filename}</span>
                <span className="analysis-file-badge">{identity.fileType}</span>
                {!identity.hasExtension && identity.mimeType ? <span className="analysis-file-badge analysis-file-badge--muted">{identity.mimeType}</span> : null}
              </div>
              <p>{toSafeResumeFailureReason(item?.error || item?.failureReason || item?.message, item)}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AnalysisItemsTable({ items = [] }) {
  const rows = Array.isArray(items) ? items : []
  if (rows.length === 0) return null

  return (
    <section className="analysis-items-panel">
      <h2>Resume files</h2>
      <div className="analysis-items-panel__table-wrap">
        <table className="analysis-items-panel__table">
          <thead>
            <tr><th>File</th><th>Type</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((item, index) => {
              const identity = buildResumeFileIdentity(item)
              return (
                <tr key={`${item?.itemId || item?.id || identity.filename}-${index}`}>
                  <td>
                    <span className="analysis-items-panel__filename">{identity.filename}</span>
                    {!identity.hasExtension && identity.mimeType ? <span className="analysis-items-panel__mime">{identity.mimeType}</span> : null}
                  </td>
                  <td><span className="analysis-file-badge">{identity.fileType}</span></td>
                  <td>{normalizeStatus(item?.status)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
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


export default function AnalysisDetailPage({ pathname = '', onPageTitleChange = null, isReadOnly = false }) {
  const analysisId = useMemo(() => {
    const parts = String(pathname || '').split('/').filter(Boolean)
    return parts.length >= 2 ? parts[1] : ''
  }, [pathname])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState(null)
  const lastKnownGoodCandidatesPayloadRef = useRef(null)
  const fallbackTelemetryFingerprintRef = useRef('')

  useEffect(() => {
    lastKnownGoodCandidatesPayloadRef.current = null
    fallbackTelemetryFingerprintRef.current = ''
  }, [analysisId])

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

        const normalizedCandidatePayload = toCandidateResultsPayload(payload)
        const { payload: validatedCandidatePayload, issues } = validateAnalysisResultsPayload(normalizedCandidatePayload)
        const hasValidationIssues = issues.length > 0
        const hasPreviousKnownGood = Boolean(lastKnownGoodCandidatesPayloadRef.current)
        const shouldFallbackToLastKnownGood = hasValidationIssues && hasPreviousKnownGood
        const safeCandidatesPayload = shouldFallbackToLastKnownGood
          ? lastKnownGoodCandidatesPayloadRef.current
          : validatedCandidatePayload

        if (!hasValidationIssues) {
          lastKnownGoodCandidatesPayloadRef.current = validatedCandidatePayload
        }

        if (shouldFallbackToLastKnownGood) {
          const fallbackFingerprint = JSON.stringify({
            analysisId: payload?.id || analysisId,
            issueCount: issues.length,
            previousOutputCount: lastKnownGoodCandidatesPayloadRef.current?.outputCount || 0,
          })
          if (fallbackTelemetryFingerprintRef.current !== fallbackFingerprint) {
            fallbackTelemetryFingerprintRef.current = fallbackFingerprint
            logResultsFallbackToLastKnownGood({
              analysisId: payload?.id || analysisId,
              fallbackReason: 'candidate_payload_validation_issues',
              previousOutputCount: lastKnownGoodCandidatesPayloadRef.current?.outputCount || 0,
              currentIssueCount: issues.length,
            })
          }
        } else {
          fallbackTelemetryFingerprintRef.current = ''
        }

        const analysisViewModel = {
          id: payload?.id,
          name: payload?.name,
          batchName: payload?.batchName,
          batch: payload?.batch,
          status: payload?.status,
          liveStatus: payload?.liveStatus,
          summary: payload?.summary && typeof payload.summary === 'object' ? payload.summary : {},
          candidatesPayload: safeCandidatesPayload,
          candidatesPayloadIssues: issues,
        }

        setAnalysis(analysisViewModel)
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
  const candidateResultsPayload = analysis?.candidatesPayload || toCandidateResultsPayload(null)
  const candidateResultsIssues = useMemo(
    () => (Array.isArray(analysis?.candidatesPayloadIssues) ? analysis.candidatesPayloadIssues : []),
    [analysis?.candidatesPayloadIssues],
  )
  const lastPayloadIssueFingerprintRef = useRef('')

  useEffect(() => {
    if (candidateResultsIssues.length > 0 && isNonProductionBuild) {
      console.error('[AnalysisDetailPage] Candidate payload validation issues.', {
        analysisId: analysis?.id || '',
        issueCount: candidateResultsIssues.length,
        issues: candidateResultsIssues,
      })
    }
  }, [analysis?.id, candidateResultsIssues])

  useEffect(() => {
    const issues = candidateResultsIssues
    if (issues.length === 0) {
      lastPayloadIssueFingerprintRef.current = ''
      return
    }

    const issueFingerprint = JSON.stringify({
      analysisId: analysis?.id || analysisId,
      droppedCount: candidateResultsPayload?.droppedCount || 0,
      inputCount: candidateResultsPayload?.inputCount || 0,
      outputCount: candidateResultsPayload?.outputCount || 0,
      issues,
    })

    if (lastPayloadIssueFingerprintRef.current === issueFingerprint) {
      return
    }

    lastPayloadIssueFingerprintRef.current = issueFingerprint
    logResultsPayloadCompatibilityIssues({
      analysisId: analysis?.id || analysisId,
      issues,
      droppedCount: candidateResultsPayload?.droppedCount,
      inputCount: candidateResultsPayload?.inputCount,
      outputCount: candidateResultsPayload?.outputCount,
    })
  }, [analysis?.id, analysisId, candidateResultsIssues, candidateResultsPayload?.droppedCount, candidateResultsPayload?.inputCount, candidateResultsPayload?.outputCount])
  const itemCount = Array.isArray(analysis?.items) ? analysis.items.length : 0
  const candidateCount = candidateResultsPayload.candidates.length
  const hasCandidateResults = candidateResultsPayload.candidates.length > 0
  const failedCount = Number(summary.failed || 0)
  const completeCount = Number(summary.complete || 0)
  const partialMessage = formatAnalysisProgressMessage(summary)
  const analysisItems = Array.isArray(analysis?.items) ? analysis.items : []
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
        {displayStatus === 'failed' && partialMessage && (
          <section className="analysis-partial-results" role="status" aria-live="polite">
            <h2>Analysis failed</h2>
            <p>{partialMessage}</p>
          </section>
        )}
        <FailedFilesSection items={analysisItems} />
        <AnalysisItemsTable items={analysisItems} />

        <CandidateResults
          candidates={candidateResultsPayload}
          isReadOnly={isReadOnly}
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
        {partialMessage && <p>{partialMessage}</p>}
        <p>Summary — Total {summary.total || 0} · Complete {completeCount} · Failed {failedCount} · Processing {summary.processing || 0} · Pending {summary.pending || 0}</p>
        <FailedFilesSection items={analysisItems} />
        <AnalysisItemsTable items={analysisItems} />
      </section>
    </main>
  )
}
