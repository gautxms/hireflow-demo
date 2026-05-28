import { useCallback, useEffect, useRef, useState } from 'react'
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
  const listRequestRef = useRef(0)
  const detailsRequestRef = useRef(0)
  const refreshInFlightRef = useRef(false)
  const queuedRefreshRef = useRef(false)

  const loadShortlists = useCallback(async () => {
    const requestId = ++listRequestRef.current
    try {
      setLoadingList(true)
      const response = await fetch(`${API_BASE}/shortlists?includeArchived=true`, {
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load shortlists')
      if (requestId !== listRequestRef.current) return null

      const nextShortlists = Array.isArray(payload.shortlists) ? payload.shortlists : []
      setShortlists(nextShortlists)
      let nextSelectedId = selectedShortlistId

      if (!selectedShortlistId && nextShortlists[0]?.id) {
        nextSelectedId = nextShortlists[0].id
        setSelectedShortlistId(nextSelectedId)
      }
      if (selectedShortlistId && !nextShortlists.some((item) => item.id === selectedShortlistId)) {
        nextSelectedId = nextShortlists[0]?.id || ''
        setSelectedShortlistId(nextSelectedId)
      }
      setError('')
      return nextSelectedId
    } catch (loadError) {
      setError(loadError.message || 'Unable to load shortlists')
      return null
    } finally {
      if (requestId === listRequestRef.current) setLoadingList(false)
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

    const requestId = ++detailsRequestRef.current
    try {
      setLoadingDetails(true)
      const response = await fetch(`${API_BASE}/shortlists/${shortlistId}?${sortMap[sortKey] || sortMap.rating_desc}`, {
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load shortlist details')
      if (requestId !== detailsRequestRef.current) return
      setShortlistDetails(payload)
      setError('')
    } catch (loadError) {
      setError(loadError.message || 'Unable to load shortlist details')
    } finally {
      if (requestId === detailsRequestRef.current) setLoadingDetails(false)
    }
  }, [shortlistSort])

  const refreshShortlists = useCallback(async () => {
    if (refreshInFlightRef.current) {
      queuedRefreshRef.current = true
      return
    }
    refreshInFlightRef.current = true
    try {
      const nextSelectedId = await loadShortlists()
      await loadShortlistDetails(nextSelectedId ?? selectedShortlistId)
    } finally {
      refreshInFlightRef.current = false
      if (queuedRefreshRef.current) {
        queuedRefreshRef.current = false
        void refreshShortlists()
      }
    }
  }, [loadShortlistDetails, loadShortlists, selectedShortlistId])

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
      } else {
        await refreshShortlists()
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

      await refreshShortlists()
    } catch (removeError) {
      setError(removeError.message || 'Unable to remove candidate from shortlist')
    } finally {
      setLoadingList(false)
    }
  }, [refreshShortlists, selectedShortlistId])

  useEffect(() => {
    void refreshShortlists()
  }, [refreshShortlists])

  useEffect(() => {
    void loadShortlistDetails(selectedShortlistId)
  }, [loadShortlistDetails, selectedShortlistId])

  useEffect(() => {
    const handleFocus = () => { void refreshShortlists() }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshShortlists()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refreshShortlists])

  return (
    <main className="candidates-directory">
      <header className="candidates-directory__hero">
        <div>
          <h1>Shortlists</h1>
          <p>Review and manage shortlisted candidates with clear job context.</p>
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
        onRetry={async () => {
          await refreshShortlists()
        }}
        onRemoveCandidate={removeCandidateFromShortlist}
        loadingList={loadingList}
        loadingDetails={loadingDetails}
        error={error}
      />
    </main>
  )
}
