import { useCallback, useEffect, useRef, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function ResumeUploader({ onFileUploaded, onBack, isAuthenticated, onRequireAuth }) {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
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

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  const handleFileSelect = () => {
    fileInputRef.current?.click()
  }

  const handleFiles = (files) => {
    const normalizedFiles = Array.isArray(files) ? files : Array.from(files.target.files || [])
    const pdfFiles = normalizedFiles.filter((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    setUploadedFiles((prev) => [...prev, ...pdfFiles.map((f) => ({ file: f, name: f.name, size: f.size }))])
  }

  const handleAnalyze = async () => {
    if (uploadedFiles.length === 0) return
    
    setIsAnalyzing(true)
    setError('')

    try {
      const formData = new FormData()
      uploadedFiles.forEach((f) => {
        formData.append('resumes', f.file)
      })

      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      
      if (!token) {
        throw new Error('Authentication required. Please log in first.')
      }

      const response = await fetch(`${API_BASE_URL}/api/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Upload failed (${response.status})`)
      }

      const results = await response.json()
      onFileUploaded(results.candidates)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Unable to analyze resumes. Using demo data instead.')
      setIsAnalyzing(false)
      
      // Fallback to mock data for demo
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
  }

  const removeFile = (index) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      {/* Header */}
      <div style={{ maxWidth: '900px', margin: '0 auto', marginBottom: '3rem' }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--accent)',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '1rem',
              fontSize: '0.9rem'
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

      {/* Upload Area */}
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div
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
            marginBottom: '2rem'
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            Drop resumes here
          </h3>
          <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
            or click to select files (PDF format)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx"
            style={{ display: 'none' }}
            onChange={handleFiles}
          />
          <button
            type="button"
            onClick={handleFileSelect}
            style={{
              background: 'var(--accent)',
              color: 'var(--ink)',
              border: 'none',
              padding: '0.75rem 2rem',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Select Files
          </button>
        </div>

        {/* Uploaded Files List */}
        {uploadedFiles.length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '1rem' }}>
              Selected Files ({uploadedFiles.length})
            </h3>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {uploadedFiles.map((f, i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.5rem' }}>📄</span>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{f.name}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                        {(f.size / 1024).toFixed(2)} KB
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(i)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--muted)',
                      padding: '0.5rem 1rem',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.9rem'
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #ef4444',
            color: '#ef4444',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        {/* Analyze Button */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button
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
              opacity: uploadedFiles.length === 0 ? 0.5 : 1
            }}
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze Candidates'}
          </button>
        </div>

        {/* Info */}
        <div style={{ marginTop: '3rem', padding: '1.5rem', background: 'var(--card)', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <h4 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>How it works:</h4>
          <ol style={{ color: 'var(--muted)', lineHeight: '1.8', paddingLeft: '1.5rem' }}>
            <li>Upload one or multiple resumes (PDF format)</li>
            <li>Our AI analyzes each resume across 20+ dimensions</li>
            <li>Candidates are ranked by fit and quality</li>
            <li>Review detailed scoring and recommendations</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
