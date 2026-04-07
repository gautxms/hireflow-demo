import { useCallback, useEffect, useMemo, useState } from 'react'

const DEFAULT_FILTERS = {
  status: 'all',
  search: '',
  startDate: '',
  endDate: '',
}

const DEFAULT_PAGINATION = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
}

function toQueryString(filters, pagination) {
  const params = new URLSearchParams({
    page: String(pagination.page),
    pageSize: String(pagination.pageSize),
  })

  if (filters.status && filters.status !== 'all') params.set('status', filters.status)
  if (filters.search.trim()) params.set('search', filters.search.trim())
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)

  return params.toString()
}

export function useAdminUploads() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION)
  const [uploads, setUploads] = useState([])
  const [stats, setStats] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [error, setError] = useState('')

  const queryString = useMemo(() => toQueryString(filters, pagination), [filters, pagination])

  const loadUploads = useCallback(async () => {
    try {
      setLoadingList(true)
      setError('')
      const response = await fetch(`/api/admin/uploads?${queryString}`, { credentials: 'include' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load uploads')
      }

      setUploads(payload.uploads || [])
      setPagination((current) => ({ ...current, ...(payload.pagination || {}) }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingList(false)
    }
  }, [queryString])

  const loadStats = useCallback(async () => {
    try {
      setLoadingStats(true)
      setError('')
      const response = await fetch(`/api/admin/uploads/stats?${queryString}`, { credentials: 'include' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load upload stats')
      }

      setStats(payload)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingStats(false)
    }
  }, [queryString])

  useEffect(() => {
    void loadUploads()
    void loadStats()
  }, [loadUploads, loadStats])

  const setPage = useCallback((page) => {
    setPagination((current) => ({ ...current, page }))
  }, [])

  const setPageSize = useCallback((pageSize) => {
    setPagination((current) => ({ ...current, pageSize, page: 1 }))
  }, [])

  const updateFilters = useCallback((patch) => {
    setPagination((current) => ({ ...current, page: 1 }))
    setFilters((current) => ({ ...current, ...patch }))
  }, [])

  return {
    filters,
    pagination,
    uploads,
    stats,
    loadingList,
    loadingStats,
    error,
    queryString,
    exportCsvUrl: `/api/admin/uploads/export?${queryString}`,
    setPage,
    setPageSize,
    updateFilters,
    reload: async () => {
      await Promise.all([loadUploads(), loadStats()])
    },
  }
}

export function useAdminUploadDetails(uploadId) {
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const [upload, setUpload] = useState(null)
  const [retriedAt, setRetriedAt] = useState(null)

  const loadUpload = useCallback(async () => {
    if (!uploadId) return

    try {
      setLoading(true)
      setError('')
      const response = await fetch(`/api/admin/uploads/${uploadId}`, { credentials: 'include' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load upload details')
      }

      setUpload(payload.upload || null)
      setRetriedAt(payload.retriedAt || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [uploadId])

  useEffect(() => {
    void loadUpload()
  }, [loadUpload])

  const retryParsing = useCallback(async () => {
    if (!uploadId) return { ok: false }

    try {
      setRetrying(true)
      setError('')

      const response = await fetch(`/api/admin/uploads/${uploadId}/retry`, {
        method: 'POST',
        credentials: 'include',
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Retry failed')
      }

      await loadUpload()
      return payload
    } catch (err) {
      setError(err.message)
      return { ok: false, error: err.message }
    } finally {
      setRetrying(false)
    }
  }, [loadUpload, uploadId])

  return {
    loading,
    retrying,
    error,
    upload,
    retriedAt,
    retryParsing,
    reload: loadUpload,
  }
}
