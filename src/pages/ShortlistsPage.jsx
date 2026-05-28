import { useCallback, useEffect, useState } from 'react'
import API_BASE from '../config/api'
import ShortlistManager from '../components/ShortlistManager'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function authHeaders() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export default function ShortlistsPage() {
  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [shortlistDetails, setShortlistDetails] = useState(null)
  const [shortlistSort, setShortlistSort] = useState('rating_desc')
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [error, setError] = useState('')

  const loadShortlists = useCallback(async () => {
    try {
      setLoadingList(true)
      setError('')
      const response = await fetch(`${API_BASE}/shortlists?includeArchived=true`, {
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load shortlists')

      const nextShortlists = Array.isArray(payload.shortlists) ? payload.shortlists : []
      setShortlists(nextShortlists)

      if (!selectedShortlistId && nextShortlists[0]?.id) {
        setSelectedShortlistId(nextShortlists[0].id)
      }
      if (selectedShortlistId && !nextShortlists.some((item) => item.id === selectedShortlistId)) {
        setSelectedShortlistId(nextShortlists[0]?.id || '')
      }
    } catch (loadError) {
      setError(loadError.message || 'Unable to load shortlists')
    } finally {
      setLoadingList(false)
    }
  }, [selectedShortlistId])

  const loadShortlistDetails = useCallback(async (shortlistId, sortKey = shortlistSort) => {
    if (!shortlistId) {
      setShortlistDetails(null)
      return
    }

    const sortMap = {
      rating_desc: 'sortBy=rating&sortOrder=desc',
      rating_asc: 'sortBy=rating&sortOrder=asc',
      added_desc: 'sortBy=added_at&sortOrder=desc',
      added_asc: 'sortBy=added_at&sortOrder=asc',
    }

    try {
      setLoadingDetails(true)
      setError('')
      const response = await fetch(`${API_BASE}/shortlists/${shortlistId}?${sortMap[sortKey] || sortMap.rating_desc}`, {
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load shortlist details')
      setShortlistDetails(payload)
    } catch (loadError) {
      setError(loadError.message || 'Unable to load shortlist details')
    } finally {
      setLoadingDetails(false)
    }
  }, [shortlistSort])

  const createShortlist = useCallback(async ({ name, description }) => {
    try {
      setLoadingList(true)
      setError('')
      const response = await fetch(`${API_BASE}/shortlists?includeArchived=true`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, description }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to create shortlist')

      await loadShortlists()
      if (payload?.shortlist?.id) {
        setSelectedShortlistId(payload.shortlist.id)
        await loadShortlistDetails(payload.shortlist.id)
      }
    } catch (createError) {
      const message = createError.message || 'Unable to create shortlist'
      setError(message)
      throw new Error(message)
    } finally {
      setLoadingList(false)
    }
  }, [loadShortlistDetails, loadShortlists])

  const removeCandidateFromShortlist = useCallback(async (resumeId) => {
    if (!selectedShortlistId || !resumeId) return

    try {
      setLoadingList(true)
      setError('')
      const response = await fetch(`${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch-remove`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ resumeIds: [resumeId] }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to remove candidate from shortlist')

      await Promise.all([
        loadShortlists(),
        loadShortlistDetails(selectedShortlistId),
      ])
    } catch (removeError) {
      setError(removeError.message || 'Unable to remove candidate from shortlist')
    } finally {
      setLoadingList(false)
    }
  }, [loadShortlistDetails, loadShortlists, selectedShortlistId])

  useEffect(() => {
    loadShortlists()
  }, [loadShortlists])

  useEffect(() => {
    loadShortlistDetails(selectedShortlistId)
  }, [loadShortlistDetails, selectedShortlistId])

  return (
    <main className="candidates-directory">
      <header className="candidates-directory__hero">
        <div>
          <h1>Shortlists</h1>
          <p>Review and manage shortlisted candidates with decision context.</p>
        </div>
      </header>

      <ShortlistManager
        shortlists={shortlists}
        selectedShortlistId={selectedShortlistId}
        shortlistDetails={shortlistDetails}
        onSelectShortlist={setSelectedShortlistId}
        onCreateShortlist={createShortlist}
        currentSort={shortlistSort}
        onChangeSort={async (sortOption) => {
          setShortlistSort(sortOption)
          await loadShortlistDetails(selectedShortlistId, sortOption)
        }}
        onRefresh={async () => {
          await loadShortlists()
          await loadShortlistDetails(selectedShortlistId)
        }}
        onRetry={async () => {
          await loadShortlists()
          await loadShortlistDetails(selectedShortlistId)
        }}
        onRemoveCandidate={removeCandidateFromShortlist}
        loadingList={loadingList}
        loadingDetails={loadingDetails}
        error={error}
      />
    </main>
  )
}
