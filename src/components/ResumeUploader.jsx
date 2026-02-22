import { useState } from 'react'

export default function ResumeUploader({ onFileUploaded }) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)

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
    const files = Array.from(e.dataTransfer.files)
    handleFiles(files)
  }

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files)
    handleFiles(files)
  }

  const handleFiles = (files) => {
    const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    setUploadedFiles(prev => [...prev, ...pdfFiles.map(f => ({ file: f, name: f.name, size: f.size }))])
  }

  const handleAnalyze = () => {
    if (uploadedFiles.length === 0) return
    setIsAnalyzing(true)
    setTimeout(() => {
      setIsAnalyzing(false)
      onFileUploaded(uploadedFiles)
    }, 2000)
  }

  const removeFile = (index) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      {/* Header */}
      <div style={{ maxWidth: '900px', margin: '0 auto', marginBottom: '3rem' }}>
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
            type="file"
            multiple
            accept=".pdf"
            onChange={handleFileInput}
            style={{ display: 'none' }}
            id="fileInput"
          />
          <label htmlFor="fileInput" style={{ cursor: 'pointer' }}>
            <button
              type="button"
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
          </label>
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
