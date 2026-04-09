import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
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

function isInfrastructureConfigError(message) {
  const normalizedMessage = String(message || '').toLowerCase()
  return normalizedMessage.includes('aws_s3_bucket')
    || normalizedMessage.includes('s3')
    || normalizedMessage.includes('credentials')
    || normalizedMessage.includes('access denied')
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

export default function ResumeUploader({ onFileUploaded, onBack, isAuthenticated, onRequireAuth, subscriptionStatus }) {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [parseProgress, setParseProgress] = useState(0)
  const [parseStatus, setParseStatus] = useState('')
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const [error, setError] = useState('')
  const [jobDescriptions, setJobDescriptions] = useState([])
  const [selectedJobDescriptionId, setSelectedJobDescriptionId] = useState('')

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
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)

    if (!token || !isAuthenticated) {
      return
    }

    fetch(`${API_BASE_URL}/api/job-descriptions`, {
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

        if (!selectedJobDescriptionId && eligible[0]?.id) {
          setSelectedJobDescriptionId(eligible[0].id)
        }
      })
      .catch(() => {
        setJobDescriptions([])
      })
  }, [isAuthenticated])

  if (!isAuthenticated) {
    return null
  }

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
    } else {
      setError('')
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

      const response = await fetch(`${API_BASE_URL}/api/uploads/chunks/${uploadId}/chunk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (response.ok) {
        return
      }

      if (attempt === MAX_CHUNK_RETRIES) {
        const errorPayload = await response.json().catch(() => ({}))
        throw new Error(errorPayload.error || `Chunk upload failed at chunk ${chunkIndex + 1}`)
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
    }
  }

  const queueLegacyUpload = async ({ token }) => {
    const formData = new FormData()

    uploadedFiles.forEach(({ file }) => {
      formData.append('resumes', file)
    })
    if (selectedJobDescriptionId) {
      formData.append('jobDescriptionId', selectedJobDescriptionId)
    }

    const response = await fetch(`${API_BASE_URL}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    const payload = await parseJsonSafe(response)

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to queue upload request')
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

    setIsAnalyzing(true)
    setError('')

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

          const initResponse = await fetch(`${API_BASE_URL}/api/uploads/chunks/init`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: file.name,
              fileSize: file.size,
              mimeType: file.type,
              jobDescriptionId: selectedJobDescriptionId || undefined,
            }),
          })

          if (!initResponse.ok) {
            const payload = await parseJsonSafe(initResponse)
            throw new Error(payload.error || `Failed to start chunk upload for ${file.name}`)
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

          const completeResponse = await fetch(`${API_BASE_URL}/api/uploads/chunks/${uploadId}/complete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })

          const completePayload = await parseJsonSafe(completeResponse)

          if (!completeResponse.ok) {
            throw new Error(completePayload.error || `Failed to finalize upload for ${file.name}`)
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
        if (!isInfrastructureConfigError(fallbackMessage)) {
          throw uploadError
        }

        const legacyQueued = await queueLegacyUpload({ token })
        primaryJobId = legacyQueued.primaryJobId
        setUploadProgress({ completed: totalChunksAllFiles, total: totalChunksAllFiles })
      }

      if (!primaryJobId) {
        throw new Error('No parse job ID returned from upload request')
      }

      setParseStatus('processing')
      setParseProgress(5)

      const pollDelayMs = 2000
      const maxPollAttempts = 300
      let queueRetryAttempt = 0

      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        const statusResponse = await fetch(`${API_BASE_URL}/api/uploads/${primaryJobId}/parse-status`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!statusResponse.ok) {
          const isQueueBusy = [429, 503, 504].includes(statusResponse.status)
          if (isQueueBusy && queueRetryAttempt < MAX_QUEUE_RETRIES) {
            queueRetryAttempt += 1
            const retryDelayMs = BASE_QUEUE_RETRY_DELAY_MS * queueRetryAttempt
            setError(
              formatMultiLineError([
                `Queue is busy. Retrying in ${Math.round(retryDelayMs / 1000)} seconds...`,
                `(attempt ${queueRetryAttempt}/${MAX_QUEUE_RETRIES})`,
              ]),
            )
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
            continue
          }
          throw new Error(`Polling failed (${statusResponse.status})`)
        }

        queueRetryAttempt = 0
        setError('')
        const statusPayload = await statusResponse.json()
        setParseStatus(statusPayload.status || 'processing')
        setParseProgress(Number(statusPayload.progress || 0))

        if (statusPayload.status === 'complete') {
          const parseResult = statusPayload.result || {}
          const candidates = parseResult.candidates || []

          if (candidates.length === 0) {
            throw new Error('Resume parsing finished, but no candidates were returned')
          }

          onFileUploaded({
            candidates,
            parseMeta: {
              methodUsed: parseResult.methodUsed || 'ai-extraction',
              confidence: Number(parseResult.confidence || 0),
              attempts: Array.isArray(parseResult.attempts) ? parseResult.attempts : [],
              requiresManualCorrection: Boolean(parseResult.requiresManualCorrection),
              feedback: parseResult.feedback || null,
            },
          })
          return
        }

        if (statusPayload.status === 'failed') {
          throw new Error(statusPayload.error || 'File format not recognized')
        }

        await new Promise((resolve) => setTimeout(resolve, pollDelayMs))
      }

      throw new Error('Resume parsing timed out. Please try again.')
    } catch (err) {
      console.error('Upload error:', err)
      setIsAnalyzing(false)
      setParseStatus('')
      setParseProgress(0)

      const errorMessage = sanitizeForDisplay(err.message || 'Unable to analyze resumes')

      if (errorMessage.includes('Subscription') || errorMessage.includes('trial') || errorMessage.includes('inactive') || errorMessage.includes('malware')) {
        setError(errorMessage)
      } else if (isInfrastructureConfigError(errorMessage)) {
        setError(formatUploadError('AWS S3 not configured'))
      } else if (
        errorMessage.toLowerCase().includes('parse')
        || errorMessage.toLowerCase().includes('no candidates')
        || errorMessage.toLowerCase().includes('format')
      ) {
        setError(formatParseError('File format not recognized'))
      } else {
        setError(formatUploadError(errorMessage))
      }
    } finally {
      setIsAnalyzing(false)
    }
  }

  const removeFile = (index) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const uploadPercent = uploadProgress.total > 0
    ? Math.round((uploadProgress.completed / uploadProgress.total) * 100)
    : 0

  return (
    <div className="resume-uploader-page" style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      <div className="resume-uploader-header" style={{ maxWidth: '900px', margin: '0 auto', marginBottom: '3rem' }}>
        {onBack && (
          <button
            className="touch-target"
            onClick={onBack}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--accent)',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '1rem',
              fontSize: '0.9rem',
            }}
          >
            ← Back
          </button>
        )}
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
          Upload Resumes
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '1rem' }}>
          Upload one or multiple resumes. Our AI will analyze and rank candidates automatically.
        </p>
      </div>

      <div className="resume-uploader-content" style={{ maxWidth: '900px', margin: '0 auto' }}>
        {subscriptionStatus === 'trialing' && (
          <div
            style={{
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid #fbbf24',
              color: '#f59e0b',
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              textAlign: 'center',
            }}
          >
            <strong>Your 7-day trial is active.</strong> After this period, upgrade your plan to continue screening resumes.
          </div>
        )}
        <div
          className="resume-drop-zone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            border: isDragging ? '2px solid var(--accent)' : '2px dashed var(--border)',
            borderRadius: '12px',
            padding: '3rem',
            textAlign: 'center',
            background: isDragging ? 'rgba(232,255,90,0.05)' : 'var(--card)',
            transition: 'all 0.3s',
            cursor: 'pointer',
            marginBottom: '2rem',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            Drop resumes here
          </h3>
          <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
            or click to select files (PDF or DOCX, up to 100MB each)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: 'none' }}
            onChange={addFiles}
          />
          <button
            className="touch-target"
            type="button"
            onClick={handleFileSelect}
            style={{
              background: 'var(--accent)',
              color: 'var(--ink)',
              border: 'none',
              padding: '0.75rem 2rem',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Select Files
          </button>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>
            Select job description for this upload
          </label>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={selectedJobDescriptionId}
              onChange={(event) => setSelectedJobDescriptionId(event.target.value)}
              style={{ minWidth: 280, border: '1px solid var(--border)', borderRadius: 8, background: '#111827', color: '#fff', padding: '0.6rem' }}
            >
              {jobDescriptions.length === 0 && (
                <option value="">No active/draft JD found</option>
              )}
              {jobDescriptions.map((jd) => (
                <option key={jd.id} value={jd.id}>
                  {jd.title} ({jd.status})
                </option>
              ))}
            </select>
            <a href="/job-descriptions" style={{ color: 'var(--accent)', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '0.55rem 0.7rem' }}>
              Manage job descriptions
            </a>
          </div>
        </div>

        {uploadedFiles.length > 0 && (
          <div className="resume-file-list" style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem' }}>
              Selected Files ({uploadedFiles.length})
            </h3>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {uploadedFiles.map((f, i) => (
                <div
                  className="resume-file-row"
                  key={i}
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.5rem' }}>📄</span>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{f.name}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                        {(f.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                  </div>
                  <button
                    className="touch-target"
                    onClick={() => removeFile(i)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--muted)',
                      padding: '0.5rem 1rem',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAnalyzing && uploadProgress.total > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ color: 'var(--muted)', textAlign: 'center', marginBottom: '0.5rem' }}>
              Upload progress: {uploadPercent}% ({uploadProgress.completed}/{uploadProgress.total} chunks)
            </p>
            <div style={{ height: '10px', borderRadius: '999px', background: 'var(--border)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${uploadPercent}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #ef4444',
              color: '#ef4444',
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              textAlign: 'left',
              whiteSpace: 'pre-line',
            }}
          >
            {error}
          </div>
        )}

        {isAnalyzing && parseStatus && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', marginBottom: '1rem' }}>
            Parsing status: {parseStatus} ({parseProgress}%)
          </p>
        )}

        <div className="resume-actions" style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button
            className="touch-target"
            onClick={handleAnalyze}
            disabled={uploadedFiles.length === 0 || isAnalyzing}
            style={{
              background: uploadedFiles.length === 0 ? 'var(--muted)' : 'var(--accent)',
              color: 'var(--ink)',
              border: 'none',
              padding: '1rem 3rem',
              borderRadius: '6px',
              fontWeight: 'bold',
              fontSize: '1rem',
              cursor: uploadedFiles.length === 0 ? 'not-allowed' : 'pointer',
              opacity: uploadedFiles.length === 0 ? 0.5 : 1,
            }}
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze Candidates'}
          </button>
        </div>
      </div>
    </div>
  )
}
