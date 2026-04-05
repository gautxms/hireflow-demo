import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const RESUME_UPLOAD_STATE_KEY = 'hireflow_resume_upload_state_v1'
const MAX_FILE_SIZE = 100 * 1024 * 1024
const CHUNK_SIZE = 5 * 1024 * 1024
const MAX_CHUNK_RETRIES = 3
const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function sanitizeForDisplay(message) {
  return DOMPurify.sanitize(message ?? '', { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
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

  const handleAuthRedirect = useCallback(() => {
    onRequireAuth('Please sign up or log in to upload resumes.')
    onBack()
  }, [onBack, onRequireAuth])

  useEffect(() => {
    if (!isAuthenticated) {
      handleAuthRedirect()
    }
  }, [handleAuthRedirect, isAuthenticated])

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

      const queuedJobs = []

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
          }),
        })

        if (!initResponse.ok) {
          const payload = await initResponse.json().catch(() => ({}))
          throw new Error(payload.error || `Failed to start chunk upload for ${file.name}`)
        }

        const initPayload = await initResponse.json()
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

        const completePayload = await completeResponse.json().catch(() => ({}))

        if (!completeResponse.ok) {
          throw new Error(completePayload.error || `Failed to finalize upload for ${file.name}`)
        }

        if (completePayload.scan?.malicious) {
          throw new Error(`Upload rejected for ${file.name}: malware detected`)
        }

        queuedJobs.push({ fileName: file.name, jobId: completePayload.jobId })

        const nextCache = readUploadCache()
        delete nextCache[fingerprint]
        writeUploadCache(nextCache)
      }

      const primaryJobId = queuedJobs[0]?.jobId

      if (!primaryJobId) {
        throw new Error('No parse job ID returned from upload request')
      }

      setParseStatus('processing')
      setParseProgress(5)

      const pollDelayMs = 2000
      const maxPollAttempts = 300

      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        const statusResponse = await fetch(`${API_BASE_URL}/api/uploads/${primaryJobId}/parse-status`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!statusResponse.ok) {
          throw new Error(`Polling failed (${statusResponse.status})`)
        }

        const statusPayload = await statusResponse.json()
        setParseStatus(statusPayload.status || 'processing')
        setParseProgress(Number(statusPayload.progress || 0))

        if (statusPayload.status === 'complete') {
          const candidates = statusPayload.result?.candidates || []

          if (candidates.length === 0) {
            throw new Error('Resume parsing finished, but no candidates were returned')
          }

          onFileUploaded(candidates)
          return
        }

        if (statusPayload.status === 'failed') {
          throw new Error(statusPayload.error || 'Resume parsing failed')
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
      } else {
        setError(`${errorMessage}. Using demo data instead.`)

        setTimeout(() => {
          const mockCandidates = [
            {
              id: '1',
              name: 'Sarah Chen',
              position: 'Senior Engineer',
              experience: '5 years',
              education: 'BS Computer Science, Stanford',
              score: 92,
              tier: 'top',
              fit: 'Excellent',
              skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'AWS'],
              pros: ['Strong technical background', 'Leadership experience', 'Excellent communication'],
              cons: ['May be overqualified'],
            },
            {
              id: '2',
              name: 'Marcus Johnson',
              position: 'Full Stack Developer',
              experience: '3 years',
              education: 'BS Information Technology, MIT',
              score: 78,
              tier: 'strong',
              fit: 'Strong',
              skills: ['React', 'Node.js', 'MongoDB', 'AWS'],
              pros: ['Quick learner', 'Team player', 'Good problem solver'],
              cons: ['Limited leadership experience'],
            },
            {
              id: '3',
              name: 'Elena Rodriguez',
              position: 'Backend Engineer',
              experience: '2 years',
              education: 'BS Computer Science, UC Berkeley',
              score: 68,
              tier: 'consider',
              fit: 'Good',
              skills: ['Node.js', 'Python', 'PostgreSQL', 'Docker'],
              pros: ['Strong backend skills', 'Quick learner'],
              cons: ['Less frontend experience', 'No AWS exposure'],
            },
          ]

          setError('')
          onFileUploaded(mockCandidates)
        }, 2000)
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
              textAlign: 'center',
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
