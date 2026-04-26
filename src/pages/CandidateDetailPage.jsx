import { useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import '../styles/candidates-directory.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return date.toLocaleString()
}

export default function CandidateDetailPage({ pathname }) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [candidate, setCandidate] = useState(null)

  const resumeId = useMemo(() => pathname.replace('/candidates/', '').trim(), [pathname])

  useEffect(() => {
    const controller = new AbortController()

    async function loadDetail() {
      try {
        setIsLoading(true)
        setError('')

        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        const response = await fetch(`${API_BASE}/candidates/${resumeId}`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        })

        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load candidate detail')
        }

        setCandidate(payload)
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setError(loadError.message || 'Unable to load candidate detail')
          setCandidate(null)
        }
      } finally {
        setIsLoading(false)
      }
    }

    if (resumeId) {
      loadDetail()
    }

    return () => controller.abort()
  }, [resumeId])

  if (isLoading) {
    return <main className="candidates-directory"><p className="candidates-directory__status">Loading profile…</p></main>
  }

  if (error) {
    return <main className="candidates-directory"><p className="candidates-directory__error">{error}</p></main>
  }

  if (!candidate) {
    return <main className="candidates-directory"><p className="candidates-directory__status">Candidate not found.</p></main>
  }

  return (
    <main className="candidates-directory">
      <a href="/candidates">← Back to candidates</a>
      <h1>{candidate.fields?.name || 'Candidate profile'}</h1>
      <p>{candidate.fields?.summary || 'No summary provided.'}</p>
      <ul>
        <li>Email: {candidate.fields?.email || 'N/A'}</li>
        <li>Phone: {candidate.fields?.phone || 'N/A'}</li>
        <li>Location: {candidate.fields?.location || 'N/A'}</li>
        <li>Years of experience: {candidate.fields?.yearsExperience ?? 'N/A'}</li>
        <li>Profile score: {candidate.fields?.profileScore ?? 'N/A'}</li>
        <li>Skills: {(candidate.fields?.skills || []).join(', ') || 'N/A'}</li>
        <li>Tags: {(candidate.fields?.tags || []).join(', ') || 'N/A'}</li>
      </ul>

      <section>
        <h2>Provenance</h2>
        <p>Latest analysis timestamp: {formatDate(candidate.provenance?.latestAnalysisTimestamp)}</p>
        <p>Source analysis: {candidate.provenance?.sourceAnalysisId || 'N/A'}</p>
        <p>Associated job: {candidate.provenance?.associatedJob?.title || 'N/A'}</p>
      </section>
    </main>
  )
}
