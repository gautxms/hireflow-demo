import { useState } from 'react'

const fieldValue = (value) => value || 'Not detected'

export default function CandidateResults({ candidates, onBack }) {
  const [showRawText, setShowRawText] = useState(false)

  if (!candidates) {
    return (
      <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back</button>
          <p>No resume is loaded yet.</p>
        </div>
      </div>
    )
  }

  const { fileMetadata, parsedFields, rawText } = candidates

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      <div style={{ maxWidth: '980px', margin: '0 auto', display: 'grid', gap: '1.25rem' }}>
        <button onClick={onBack} style={{ width: 'fit-content', background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>

        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', fontFamily: 'var(--font-display)', margin: 0 }}>Parsed Resume Viewer</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>This is a real-time preview of how Hireflow currently reads resumes.</p>

        <section style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.2rem' }}>
          <h2 style={{ marginTop: 0 }}>Section 1 — File Metadata</h2>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.8 }}>
            <li><strong>Filename:</strong> {fileMetadata.filename}</li>
            <li><strong>Upload timestamp:</strong> {new Date(fileMetadata.uploadTimestamp).toLocaleString()}</li>
            <li><strong>Page count:</strong> {fileMetadata.pageCount}</li>
          </ul>
        </section>

        <section style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.2rem' }}>
          <h2 style={{ marginTop: 0 }}>Section 2 — Parsed Fields</h2>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.8 }}>
            <li><strong>Name:</strong> {fieldValue(parsedFields.name)}</li>
            <li><strong>Email:</strong> {fieldValue(parsedFields.email)}</li>
            <li><strong>Phone:</strong> {fieldValue(parsedFields.phone)}</li>
            <li><strong>Sections found:</strong> {parsedFields.sectionsFound.length ? parsedFields.sectionsFound.join(', ') : 'Not detected'}</li>
          </ul>
        </section>

        <section style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.2rem' }}>
          <h2 style={{ marginTop: 0 }}>Section 3 — Raw Extracted Text</h2>
          <p style={{ marginTop: 0, color: 'var(--muted)' }}>Raw text extracted from PDF</p>
          <button onClick={() => setShowRawText((state) => !state)} style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.45rem 0.85rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '0.9rem' }}>
            {showRawText ? 'Hide text' : 'Show text'}
          </button>

          {showRawText && (
            <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {rawText}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
