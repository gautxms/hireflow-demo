import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../config/api'
import JobsTable from '../components/jobs/JobsTable'
import '../styles/analyses.css'
import '../styles/job-description.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function JobDescriptionPage({ onRequireAuth }) {
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const token = useMemo(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '', [])

  const fetchItems = useCallback(async () => {
    if (!token) {
      onRequireAuth?.('Please login to manage job descriptions.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/job-descriptions?includeArchived=true`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load job descriptions')
      }

      setItems(Array.isArray(payload.items) ? payload.items : [])
    } catch (requestError) {
      setError(requestError.message || 'Unable to load job descriptions')
    } finally {
      setIsLoading(false)
    }
  }, [onRequireAuth, token])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  return (
    <section className="analyses-layout job-description-page">
      <div className="analyses-layout__content">
        <header className="analyses-page__header">
          <div>
            <h1>Jobs</h1>
            <p>Manage your job descriptions used for resume screening workflows.</p>
          </div>
          <button type="button" className="job-description-page__create-button">
            Create Job
          </button>
        </header>

        {isLoading ? <p className="analyses-layout__state analyses-layout__state--loading">Loading jobs…</p> : null}
        {!isLoading && error ? <p className="analyses-layout__state analyses-layout__state--error">{error}</p> : null}
        {!isLoading && !error && items.length === 0 ? (
          <p className="analyses-layout__state analyses-layout__state--empty">No jobs yet. Create your first job to get started.</p>
        ) : null}
        {!isLoading && !error && items.length > 0 ? <JobsTable items={items} /> : null}
      </div>
    </section>
  )
}
