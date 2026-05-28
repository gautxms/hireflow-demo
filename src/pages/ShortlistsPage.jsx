import { useCallback, useEffect, useRef, useState } from 'react'
import API_BASE from '../config/api'
import ShortlistManager from '../components/ShortlistManager'
import { removeShortlistCandidate } from '../components/shortlistState'
import '../styles/shortlists.css'

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
  const [jobDescriptions, setJobDescriptions] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [error, setError] = useState('')
  const listRequestRef = useRef(0)
  const detailsRequestRef = useRef(0)
  const refreshInFlightRef = useRef(false)
  const queuedRefreshRef = useRef(false)
  const selectedShortlistIdRef = useRef('')
  const didInitialLoadRef = useRef(false)

  useEffect(() => {
    selectedShortlistIdRef.current = selectedShortlistId
  }, [selectedShortlistId])

  const loadShortlists = useCallback(async ({ preserveSelectedId } = {}) => {
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
      const currentSelectedId = preserveSelectedId ?? selectedShortlistIdRef.current
      let nextSelectedId = currentSelectedId

      if (currentSelectedId && !nextShortlists.some((item) => item.id === currentSelectedId)) {
        nextSelectedId = nextShortlists[0]?.id || ''
        selectedShortlistIdRef.current = nextSelectedId
        setSelectedShortlistId(nextSelectedId)
      } else if (!currentSelectedId && nextShortlists[0]?.id) {
        nextSelectedId = nextShortlists[0].id
        selectedShortlistIdRef.current = nextSelectedId
        setSelectedShortlistId(nextSelectedId)
      }
      setError('')
      return { ok: true, selectedId: nextSelectedId }
    } catch (loadError) {
      setError(loadError.message || 'Unable to load shortlists')
      return { ok: false, selectedId: selectedShortlistIdRef.current }
    } finally {
      if (requestId === listRequestRef.current) setLoadingList(false)
    }
  }, [])

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

  const loadJobDescriptions = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/job-descriptions`, {
        headers: authHeaders(),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load jobs')
      setJobDescriptions(Array.isArray(payload.items) ? payload.items : [])
    } catch {
      setJobDescriptions([])
    }
  }, [])

  const refreshShortlists = useCallback(async () => {
    if (refreshInFlightRef.current) {
      queuedRefreshRef.current = true
      return
    }
    refreshInFlightRef.current = true
    try {
      const result = await loadShortlists()
      if (result?.ok) {
        await loadShortlistDetails(result.selectedId)
      }
    } finally {
      refreshInFlightRef.current = false
      if (queuedRefreshRef.current) {
        queuedRefreshRef.current = false
        void refreshShortlists()
      }
    }
  }, [loadShortlistDetails, loadShortlists])

  const createShortlist = useCallback(async ({ name, description, jobDescriptionId }) => {
    try {
      setLoadingList(true)
      setError('')
      const response = await fetch(`${API_BASE}/shortlists?includeArchived=true`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, description, jobDescriptionId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to create shortlist')

      if (payload?.shortlist?.id) {
        selectedShortlistIdRef.current = payload.shortlist.id
        setSelectedShortlistId(payload.shortlist.id)
        await loadShortlists({ preserveSelectedId: payload.shortlist.id })
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
  }, [loadShortlistDetails, loadShortlists, refreshShortlists])

  const removeCandidateFromShortlist = useCallback(async (resumeId) => {
    if (!selectedShortlistId || !resumeId) return

    try {
      setError('')
      const response = await fetch(`${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch-remove`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ resumeIds: [resumeId] }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to remove candidate from shortlist')

      const removedCount = Number(payload?.summary?.removed || 0)
      const candidateWasVisible = (shortlistDetails?.candidates || []).some((candidate) => candidate.resume_id === resumeId)
      const countDelta = Math.max(removedCount, candidateWasVisible ? 1 : 0)
      if (countDelta <= 0) return

      setShortlistDetails((currentDetails) => (currentDetails ? removeShortlistCandidate(currentDetails, resumeId) : currentDetails))
      setShortlists((currentShortlists) => currentShortlists.map((shortlist) => {
        if (shortlist.id !== selectedShortlistId) return shortlist
        const currentCount = Number(shortlist.candidate_count || 0)
        return { ...shortlist, candidate_count: Math.max(0, currentCount - countDelta) }
      }))
    } catch (removeError) {
      setError(removeError.message || 'Unable to remove candidate from shortlist')
    }
  }, [selectedShortlistId, shortlistDetails?.candidates])

  useEffect(() => {
    if (didInitialLoadRef.current) return
    didInitialLoadRef.current = true
    void refreshShortlists()
    void loadJobDescriptions()
  }, [loadJobDescriptions, refreshShortlists])

  useEffect(() => {
    void loadShortlistDetails(selectedShortlistId)
  }, [loadShortlistDetails, selectedShortlistId])

  return (
    <main className="shortlists-page">
      <div className="shortlists-page__content">
        <ShortlistManager
          shortlists={shortlists}
          selectedShortlistId={selectedShortlistId}
          shortlistDetails={shortlistDetails}
          jobDescriptions={jobDescriptions}
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
      </div>
    </main>
  )
}
