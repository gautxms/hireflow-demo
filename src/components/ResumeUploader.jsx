import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import API_BASE from '../config/api'
import { buildRoleSafeErrorView, isStorageInfrastructureError, mapProviderError } from './aiProviderErrorMapping'
import {
  ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL,
  buildChunkInitPayload,
  resolveSelectedJobDescriptionId,
  toOptionalJobDescriptionId,
} from './resumeUploaderState'
import {
  buildFileSnapshot,
  clearResumeAnalysisResult,
  clearResumeAnalysisSession,
  isSessionRecoverable,
  readResumeAnalysisResult,
  readResumeAnalysisSession,
  writeResumeAnalysisResult,
  writeResumeAnalysisSession,
} from './resumeAnalysisSession'
import { buildFailedAnalysisState } from './resumeUploaderRecoveryState'
import { shouldSkipStateUpdate, waitWithAbort } from './abortableAsync'
import '../styles/resume-uploader.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const RESUME_UPLOAD_STATE_KEY = 'hireflow_resume_upload_state_v1'
const MAX_FILE_SIZE = 100 * 1024 * 1024
const CHUNK_SIZE = 5 * 1024 * 1024
const MAX_CHUNK_RETRIES = 3
const MAX_QUEUE_RETRIES = 3
const BASE_QUEUE_RETRY_DELAY_MS = 5000
const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function sanitizeForDisplay(message) {
  return DOMPurify.sanitize(message ?? '', { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
}

function withErrorContext(error, context = {}) {
  const nextError = error instanceof Error ? error : new Error(String(error || 'unknown_error'))
  nextError.context = {
    ...(nextError.context && typeof nextError.context === 'object' ? nextError.context : {}),
    ...context,
  }
  return nextError
}

function formatMultiLineError(lines) {
  return lines.filter(Boolean).join('\n')
}

function formatUploadError(message) {
  return formatMultiLineError([
    '❌ Unable to upload',
    `Reason: ${message || 'Upload service unavailable'}`,
    'Action: Contact support or try again later',
  ])
}

function formatParseError(reason = 'File format not recognized') {
  return formatMultiLineError([
    '⚠️ Parse Failed',
    `Reason: ${reason}`,
    'Next: Try a different format (PDF/DOCX)',
  ])
}

async function parseJsonSafe(response) {
  return response.json().catch(() => ({}))
}

function getFileFingerprint(file) {
  return `${file.name}::${file.size}::${file.lastModified}`
}

function readUploadCache() {
  try {
    return JSON.parse(localStorage.getItem(RESUME_UPLOAD_STATE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeUploadCache(next) {
  localStorage.setItem(RESUME_UPLOAD_STATE_KEY, JSON.stringify(next))
}

export default function ResumeUploader({ onFileUploaded, onBack, isAuthenticated, onRequireAuth, subscriptionStatus, isAdmin = false }) {
  const fileInputRef = useRef(null)
  const mountedRef = useRef(true)
  const activePollAbortControllerRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [parseProgress, setParseProgress] = useState(0)
  const [parseStatus, setParseStatus] = useState('')
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const [error, setError] = useState('')
  const [technicalErrorDetails, setTechnicalErrorDetails] = useState('')
  const [providerErrorGuidance, setProviderErrorGuidance] = useState(null)
  const [jobDescriptions, setJobDescriptions] = useState([])
  const [selectedJobDescriptionId, setSelectedJobDescriptionId] = useState('')
  const [recoverableSession, setRecoverableSession] = useState(null)
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false)
  const [failedAnalysisState, setFailedAnalysisState] = useState(null)
  const isActiveSubscriber = (subscriptionStatus || '').toLowerCase() === 'active'
  const isDevelopment = import.meta.env.DEV
  const canViewAdminDiagnostics = isAdmin || isDevelopment

  const handleAuthRedirect = useCallback(() => {
    onRequireAuth('Please sign up or log in to upload resumes.')
    onBack()
  }, [onBack, onRequireAuth])

  useEffect(() => {
    if (!isAuthenticated) {
      handleAuthRedirect()
    }
  }, [handleAuthRedirect, isAuthenticated])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      activePollAbortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)

    if (!token || !isAuthenticated) {
      return
    }

    fetch(`${API_BASE}/job-descriptions`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
      .then(({ ok, payload }) => {
        if (!ok) {
          return
        }

        const items = Array.isArray(payload.items) ? payload.items : []
        const eligible = items.filter((item) => item.status === 'active' || item.status === 'draft')
        setJobDescriptions(eligible)

        setSelectedJobDescriptionId((currentSelection) => resolveSelectedJobDescriptionId(currentSelection, eligible))
      })
      .catch(() => {
        setJobDescriptions([])
      })
  }, [isAuthenticated])

  useEffect(() => {
    const cachedSession = readResumeAnalysisSession()
    if (!isSessionRecoverable(cachedSession)) {
      return
    }

    setRecoverableSession(cachedSession)
    setShowRecoveryPrompt(true)
    if (Array.isArray(cachedSession.fileSnapshots) && cachedSession.fileSnapshots.length > 0) {
      setUploadedFiles(
        cachedSession.fileSnapshots.map((fileSnapshot) => ({
          ...fileSnapshot,
          file: null,
          restoredFromSession: true,
        })),
      )
    }
    if (cachedSession.selectedJobDescriptionId) {
      setSelectedJobDescriptionId(cachedSession.selectedJobDescriptionId)
    }
  }, [])

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const addFiles = (incomingFiles) => {
    const normalizedFiles = Array.isArray(incomingFiles) ? incomingFiles : Array.from(incomingFiles.target.files || [])
    const allowed = []
    const rejected = []

    normalizedFiles.forEach((file) => {
      const isAllowedType = ACCEPTED_TYPES.has(file.type)
      const isAllowedSize = file.size <= MAX_FILE_SIZE

      if (!isAllowedType) {
        rejected.push(`${file.name}: only PDF or DOCX files are allowed.`)
        return
      }

      if (!isAllowedSize) {
        rejected.push(`${file.name}: exceeds 100MB file size limit.`)
        return
      }

      allowed.push({ file, name: file.name, size: file.size })
    })

    if (rejected.length > 0) {
      setError(sanitizeForDisplay(rejected.join(' ')))
      setTechnicalErrorDetails('')
      setProviderErrorGuidance(null)
    } else {
      setError('')
      setTechnicalErrorDetails('')
      setProviderErrorGuidance(null)
    }

    if (allowed.length > 0) {
      setUploadedFiles((prev) => [...prev, ...allowed])
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const handleFileSelect = () => {
    fileInputRef.current?.click()
  }

  const uploadChunkWithRetry = async ({ uploadId, chunk, chunkIndex, totalChunks, token }) => {
    for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt += 1) {
      const formData = new FormData()
      formData.append('chunk', chunk)
      formData.append('chunkIndex', String(chunkIndex))
      formData.append('totalChunks', String(totalChunks))

      const response = await fetch(`${API_BASE}/uploads/chunks/${uploadId}/chunk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (response.ok) {
        return
      }

      if (attempt === MAX_CHUNK_RETRIES) {
        const errorPayload = await response.json().catch(() => ({}))
        throw withErrorContext(new Error(errorPayload.error || `Chunk upload failed at chunk ${chunkIndex + 1}`), {
          stage: 'upload_chunk',
          endpoint: '/uploads/chunks/:uploadId/chunk',
          status: response.status,
        })
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
    }
  }

  const queueLegacyUpload = async ({ token }) => {
    const formData = new FormData()

    uploadedFiles.forEach(({ file }) => {
      formData.append('resumes', file)
    })
    const optionalJobDescriptionId = toOptionalJobDescriptionId(selectedJobDescriptionId)
    if (optionalJobDescriptionId) {
      formData.append('jobDescriptionId', optionalJobDescriptionId)
    }

    const response = await fetch(`${API_BASE}/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    const payload = await parseJsonSafe(response)

    if (!response.ok) {
      throw withErrorContext(new Error(payload.error || 'Unable to queue upload request'), {
        stage: 'upload_init',
        endpoint: '/uploads',
        status: response.status,
      })
    }

    const jobs = Array.isArray(payload.jobs) ? payload.jobs : []
    const primaryJobId = payload.jobId || jobs[0]?.jobId

    if (!primaryJobId) {
      throw new Error('No parse job ID returned from upload request')
    }

    return { primaryJobId }
  }

  const handleAnalyze = async () => {
    if (uploadedFiles.length === 0) return
    if (uploadedFiles.some((item) => !item.file)) {
      setError('Please re-select files before retrying analysis.')
      return
    }

    setIsAnalyzing(true)
    setError('')
    setTechnicalErrorDetails('')
    setProviderErrorGuidance(null)
    clearResumeAnalysisResult()

    try {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)

      if (!token) {
        throw new Error('Authentication required. Please log in first.')
      }

      const totalChunksAllFiles = uploadedFiles.reduce((sum, item) => sum + Math.ceil(item.file.size / CHUNK_SIZE), 0)
      let uploadedChunkCount = 0
      setUploadProgress({ completed: uploadedChunkCount, total: totalChunksAllFiles })

      let primaryJobId = ''

      try {
        for (const entry of uploadedFiles) {
          const file = entry.file
          const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
          const fingerprint = getFileFingerprint(file)

          const initResponse = await fetch(`${API_BASE}/uploads/chunks/init`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(buildChunkInitPayload({
              filename: file.name,
              fileSize: file.size,
              mimeType: file.type,
              selectedJobDescriptionId,
            })),
          })

          if (!initResponse.ok) {
            const payload = await parseJsonSafe(initResponse)
            throw withErrorContext(new Error(payload.error || `Failed to start chunk upload for ${file.name}`), {
              stage: 'upload_init',
              endpoint: '/uploads/chunks/init',
              status: initResponse.status,
            })
          }

          const initPayload = await parseJsonSafe(initResponse)
          const uploadId = initPayload.uploadId
          const uploadedChunks = new Set(initPayload.uploadedChunks || [])

          const cache = readUploadCache()
          cache[fingerprint] = { uploadId, totalChunks }
          writeUploadCache(cache)

          uploadedChunkCount += uploadedChunks.size
          setUploadProgress({ completed: uploadedChunkCount, total: totalChunksAllFiles })

          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
            if (uploadedChunks.has(chunkIndex)) {
              continue
            }

            const start = chunkIndex * CHUNK_SIZE
            const end = Math.min(start + CHUNK_SIZE, file.size)
            const chunk = file.slice(start, end)

            await uploadChunkWithRetry({
              uploadId,
              chunk,
              chunkIndex,
              totalChunks,
              token,
            })

            uploadedChunkCount += 1
            setUploadProgress({ completed: uploadedChunkCount, total: totalChunksAllFiles })
          }

          const completeResponse = await fetch(`${API_BASE}/uploads/chunks/${uploadId}/complete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })

          const completePayload = await parseJsonSafe(completeResponse)

          if (!completeResponse.ok) {
            throw withErrorContext(new Error(completePayload.error || `Failed to finalize upload for ${file.name}`), {
              stage: 'upload_complete',
              endpoint: '/uploads/chunks/:uploadId/complete',
              status: completeResponse.status,
            })
          }

          if (completePayload.scan?.malicious) {
            throw new Error(`Upload rejected for ${file.name}: malware detected`)
          }

          primaryJobId = primaryJobId || completePayload.jobId

          const nextCache = readUploadCache()
          delete nextCache[fingerprint]
          writeUploadCache(nextCache)
        }

      } catch (uploadError) {
        const fallbackMessage = sanitizeForDisplay(uploadError.message || '')
        if (!isStorageInfrastructureError(fallbackMessage)) {
          throw uploadError
        }

        const legacyQueued = await queueLegacyUpload({ token })
        primaryJobId = legacyQueued.primaryJobId
        setUploadProgress({ completed: totalChunksAllFiles, total: totalChunksAllFiles })
      }

      if (!primaryJobId) {
        throw new Error('No parse job ID returned from upload request')
      }
      writeResumeAnalysisSession({
        jobId: primaryJobId,
        parseStatus: 'processing',
        parseProgress: 5,
        selectedJobDescriptionId,
        fileSnapshots: buildFileSnapshot(uploadedFiles),
      })

      await trackParseStatus({ token, primaryJobId })
    } catch (err) {
      if (err?.name === 'AbortError') {
        return
      }
      console.error('Upload error:', err)
      setIsAnalyzing(false)
      setParseStatus('')
      setParseProgress(0)

      const errorMessage = sanitizeForDisplay(err.message || 'Unable to analyze resumes')
      const currentSession = readResumeAnalysisSession()
      if (currentSession?.jobId) {
        writeResumeAnalysisSession({
          ...currentSession,
          parseStatus: 'failed',
        })
      }
      const normalizedProviderError = mapProviderError(errorMessage)
      const errorContext = err?.context && typeof err.context === 'object' ? err.context : {}
      const isUploadStage = String(errorContext.stage || '').startsWith('upload')
      const isParseStatusStage = errorContext.stage === 'parse_status'

      if (errorMessage.includes('Subscription') || errorMessage.includes('trial') || errorMessage.includes('inactive') || errorMessage.includes('malware')) {
        setError(errorMessage)
        setTechnicalErrorDetails('')
        setProviderErrorGuidance(null)
      } else if (isUploadStage && isStorageInfrastructureError(errorMessage)) {
        setError(formatUploadError('Storage service is unavailable'))
        setTechnicalErrorDetails('')
        setProviderErrorGuidance(null)
      } else if (
        !isParseStatusStage
        && (
          errorMessage.toLowerCase().includes('parse')
          || errorMessage.toLowerCase().includes('no candidates')
          || errorMessage.toLowerCase().includes('format')
        )
      ) {
        const safeView = buildRoleSafeErrorView(normalizedProviderError, {
          isAdmin,
          isDevelopment,
        })
        setError(formatParseError('File format not recognized'))
        setTechnicalErrorDetails(canViewAdminDiagnostics ? errorMessage : '')
        setProviderErrorGuidance(safeView.providerErrorGuidance)
      } else {
        const safeView = buildRoleSafeErrorView(normalizedProviderError, {
          isAdmin,
          isDevelopment,
        })
        setError(safeView.userMessage)
        setTechnicalErrorDetails(safeView.technicalErrorDetails)
        setProviderErrorGuidance(safeView.providerErrorGuidance)
      }

      setFailedAnalysisState(buildFailedAnalysisState(errorMessage))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const trackParseStatus = useCallback(async ({ token, primaryJobId }) => {
    setParseStatus('processing')
    setParseProgress(5)
    setShowRecoveryPrompt(false)
    setRecoverableSession(null)

    const pollDelayMs = 2000
    const maxPollAttempts = 300
    let queueRetryAttempt = 0
    const abortController = new AbortController()
    activePollAbortControllerRef.current = abortController

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (shouldSkipStateUpdate({ mounted: mountedRef.current, signal: abortController.signal })) {
        throw new DOMException('Polling aborted', 'AbortError')
      }

      const statusResponse = await fetch(`${API_BASE}/uploads/${primaryJobId}/parse-status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: abortController.signal,
      })

      if (!statusResponse.ok) {
        const isQueueBusy = [429, 503, 504].includes(statusResponse.status)
        if (isQueueBusy && queueRetryAttempt < MAX_QUEUE_RETRIES) {
          queueRetryAttempt += 1
          const retryDelayMs = BASE_QUEUE_RETRY_DELAY_MS * queueRetryAttempt
          if (mountedRef.current) {
            setError(
              formatMultiLineError([
                `Queue is busy. Retrying in ${Math.round(retryDelayMs / 1000)} seconds...`,
                `(attempt ${queueRetryAttempt}/${MAX_QUEUE_RETRIES})`,
              ]),
            )
          }
          await waitWithAbort(retryDelayMs, abortController.signal)
          continue
        }
        throw withErrorContext(new Error(`Polling failed (${statusResponse.status})`), {
          stage: 'parse_status',
          endpoint: '/uploads/:jobId/parse-status',
          status: statusResponse.status,
        })
      }

      queueRetryAttempt = 0
      if (mountedRef.current) {
        setError('')
      }
      const statusPayload = await statusResponse.json()
      const nextStatus = statusPayload.status || 'processing'
      const nextProgress = Number(statusPayload.progress || 0)

      writeResumeAnalysisSession({
        jobId: primaryJobId,
        parseStatus: nextStatus,
        parseProgress: nextProgress,
        selectedJobDescriptionId,
        fileSnapshots: buildFileSnapshot(uploadedFiles),
      })

      if (mountedRef.current) {
        setParseStatus(nextStatus)
        setParseProgress(nextProgress)
      }

      if (nextStatus === 'complete') {
        const parseResult = statusPayload.result || {}
        const candidates = parseResult.candidates || []

        if (candidates.length === 0) {
          throw new Error('Resume parsing finished, but no candidates were returned')
        }

        const latestResult = {
          candidates,
          parseMeta: {
            methodUsed: parseResult.methodUsed || 'ai-extraction',
            confidence: Number(parseResult.confidence || 0),
            attempts: Array.isArray(parseResult.attempts) ? parseResult.attempts : [],
            requiresManualCorrection: Boolean(parseResult.requiresManualCorrection),
            feedback: parseResult.feedback || null,
          },
        }

        writeResumeAnalysisSession({
          jobId: primaryJobId,
          parseStatus: 'complete',
          parseProgress: 100,
          selectedJobDescriptionId,
          fileSnapshots: buildFileSnapshot(uploadedFiles),
        })
        try {
          writeResumeAnalysisResult({
            ...latestResult,
            jobId: primaryJobId,
          })
        } catch (persistError) {
          console.warn('Unable to persist resume analysis result for recovery', persistError)
        }

        onFileUploaded(latestResult)
        clearResumeAnalysisSession()
        return
      }

      if (nextStatus === 'failed') {
        throw withErrorContext(new Error(statusPayload.error || 'unknown_error'), {
          stage: 'parse_status',
          endpoint: '/uploads/:jobId/parse-status',
          status: 200,
        })
      }

      await waitWithAbort(pollDelayMs, abortController.signal)
    }

    throw new Error('Resume parsing timed out. Please try again.')
  }, [onFileUploaded, selectedJobDescriptionId, uploadedFiles])

  const handleResumeTracking = async () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    const recoverableJobId = recoverableSession?.jobId || readResumeAnalysisResult()?.jobId
    if (!token || !recoverableJobId) {
      setShowRecoveryPrompt(false)
      return
    }
    setIsAnalyzing(true)
    setError('')
    setTechnicalErrorDetails('')
    setProviderErrorGuidance(null)
    setFailedAnalysisState(null)
    try {
      await trackParseStatus({ token, primaryJobId: recoverableJobId })
    } catch (resumeError) {
      if (resumeError?.name !== 'AbortError') {
        setError(sanitizeForDisplay(resumeError.message || 'Unable to resume analysis.'))
      }
    } finally {
      if (mountedRef.current) {
        setIsAnalyzing(false)
      }
    }
  }

  const handleDiscardRecovery = () => {
    clearResumeAnalysisSession()
    setRecoverableSession(null)
    setShowRecoveryPrompt(false)
    setParseStatus('')
    setParseProgress(0)
  }

  const removeFile = (index) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const uploadPercent = uploadProgress.total > 0
    ? Math.round((uploadProgress.completed / uploadProgress.total) * 100)
    : 0

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="resume-uploader-page">
      <div className="resume-uploader-header">
        {onBack && (
          <button
            className="touch-target resume-uploader-back-button"
            onClick={onBack}
          >
            ← Back
          </button>
        )}
        <h1 className="resume-uploader-title">
          Upload Resumes
        </h1>
        <p className="resume-uploader-subtitle">
          Upload one or multiple resumes. Our AI will analyze and rank candidates automatically.
        </p>
      </div>

      <div className="resume-uploader-content">
        {subscriptionStatus === 'trialing' && (
          <div className="resume-uploader-trial-banner">
            <strong>Your 7-day trial is active.</strong> After this period, upgrade your plan to continue screening resumes.
          </div>
        )}
        {showRecoveryPrompt && recoverableSession && (
          <div className="resume-uploader-trial-banner" role="status">
            <strong>Unfinished analysis detected.</strong> Resume your previous run or discard it and start fresh.
            <div className="resume-actions resume-actions--recovery-prompt">
              <button type="button" className="touch-target resume-analyze-button" onClick={handleResumeTracking}>
                Resume tracking
              </button>
              <button type="button" className="touch-target resume-remove-file-button" onClick={handleDiscardRecovery}>
                Discard and start fresh
              </button>
            </div>
          </div>
        )}
        <div
          className={`resume-drop-zone ${isDragging ? 'resume-drop-zone--dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="resume-drop-zone-icon">📄</div>
          <h3 className="resume-drop-zone-title">
            Drop resumes here
          </h3>
          <p className="resume-drop-zone-subtitle">
            or click to select files (PDF or DOCX, up to 100MB each)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="resume-file-input"
            onChange={addFiles}
          />
          <button
            type="button"
            onClick={handleFileSelect}
            className="touch-target resume-select-files-button"
          >
            Select Files
          </button>
        </div>

        <div className="resume-jd-selector">
          <label className="resume-jd-selector-label">
            Select job description for this upload
          </label>
          <div className="resume-jd-selector-row">
            <select
              value={selectedJobDescriptionId}
              onChange={(event) => setSelectedJobDescriptionId(event.target.value)}
              className="resume-jd-select"
            >
              <option value="">{ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL}</option>
              {jobDescriptions.map((jd) => (
                <option key={jd.id} value={jd.id}>
                  {jd.title} ({jd.status})
                </option>
              ))}
            </select>
            {isActiveSubscriber && (
              <a href="/job-descriptions" className="resume-manage-jd-link">
                Manage job descriptions
              </a>
            )}
          </div>
          <p className="resume-jd-selector-helper">
            No JD selected = extract candidate profiles only; fit scoring will be limited.
          </p>
        </div>

        {uploadedFiles.length > 0 && (
          <div className="resume-file-list">
            <h3 className="resume-file-list-title">
              Selected Files ({uploadedFiles.length})
            </h3>
            <div className="resume-file-list-grid">
              {uploadedFiles.map((f, i) => (
                <div
                  className="resume-file-row"
                  key={i}
                >
                  <div className="resume-file-meta">
                    <span className="resume-file-icon">📄</span>
                    <div>
                      <div className="resume-file-name">{f.name}</div>
                      <div className="resume-file-size">
                        {(f.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                      {f.restoredFromSession && (
                        <div className="resume-file-size">
                          Restored from previous session — re-select file to re-upload if retrying.
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    className="resume-remove-file-button"
                    onClick={() => removeFile(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAnalyzing && uploadProgress.total > 0 && (
          <div className="resume-upload-progress">
            <p className="resume-upload-progress-label">
              Upload progress: {uploadPercent}% ({uploadProgress.completed}/{uploadProgress.total} chunks)
            </p>
            <div className="resume-upload-progress-bar">
              <div
                className="resume-upload-progress-fill"
                // inline-style-allow runtime-dimension
                style={{
                  width: `${uploadPercent}%`,
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="resume-error-banner">
            {error}
            {providerErrorGuidance && (
              <div className="resume-error-guidance">
                <p>
                  {providerErrorGuidance.provider || providerErrorGuidance.model
                    ? `Provider context: ${[providerErrorGuidance.provider, providerErrorGuidance.model].filter(Boolean).join(' / ')}`
                    : 'Provider context: check the active AI provider configuration.'}
                </p>
                {providerErrorGuidance.remediationSteps.length > 0 && (
                  <ol>
                    {providerErrorGuidance.remediationSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                <a href={providerErrorGuidance.adminPath || '/admin/security'}>
                  {providerErrorGuidance.actionHint || 'Go to Admin Security'}
                </a>
              </div>
            )}
            {canViewAdminDiagnostics && technicalErrorDetails && (
              <details className="resume-error-details">
                <summary className="resume-error-details-summary">Technical details</summary>
                <pre className="resume-error-details-pre">
                  {technicalErrorDetails}
                </pre>
              </details>
            )}
          </div>
        )}

        {failedAnalysisState && (
          <div className="resume-error-banner" role="alert">
            <strong>{failedAnalysisState.message}</strong>
            <p>{failedAnalysisState.detail}</p>
            <div className="resume-actions resume-actions--failure">
              <button type="button" className="touch-target resume-analyze-button" onClick={handleAnalyze}>
                Retry
              </button>
              <button type="button" className="touch-target resume-select-files-button" onClick={() => setSelectedJobDescriptionId('')}>
                Use fallback provider
              </button>
              <a href="/contact" className="touch-target resume-manage-jd-link">
                Contact support
              </a>
            </div>
          </div>
        )}

        {isAnalyzing && parseStatus && (
          <p className="resume-parse-status">
            Parsing status: {parseStatus} ({parseProgress}%)
          </p>
        )}

        <div className="resume-actions">
          <button
            className={`touch-target resume-analyze-button ${uploadedFiles.length === 0 ? 'resume-analyze-button--disabled' : ''}`}
            onClick={handleAnalyze}
            disabled={uploadedFiles.length === 0 || isAnalyzing}
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze Candidates'}
          </button>
        </div>
      </div>
    </div>
  )
}
