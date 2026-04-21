import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { adminFetchJson, getMappedError } from '../utils/adminErrorState'

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

function toStatsQueryString(filters) {
  const params = new URLSearchParams()

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
  const [error, setError] = useState(null)

  const queryString = useMemo(() => toQueryString(filters, pagination), [filters, pagination])
  const statsQueryString = useMemo(() => toStatsQueryString(filters), [filters])

  const loadUploads = useCallback(async () => {
    try {
      setLoadingList(true)
      setError(null)
      const payload = await adminFetchJson(`${API_BASE}/admin/uploads?${queryString}`, 'Failed to load uploads')

      setUploads(payload.uploads || [])
      setPagination((current) => ({ ...current, ...(payload.pagination || {}) }))
    } catch (err) {
      setError(getMappedError(err, 'Uploads data could not be loaded.'))
    } finally {
      setLoadingList(false)
    }
  }, [queryString])

  const loadStats = useCallback(async () => {
    try {
      setLoadingStats(true)
      setError(null)
      const payload = await adminFetchJson(`${API_BASE}/admin/uploads/stats?${statsQueryString}`, 'Failed to load upload stats')

      setStats(payload)
    } catch (err) {
      setError(getMappedError(err, 'Uploads data could not be loaded.'))
    } finally {
      setLoadingStats(false)
    }
  }, [statsQueryString])

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
    exportCsvUrl: `${API_BASE}/admin/uploads/export?${queryString}`,
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
  const [error, setError] = useState(null)
  const [upload, setUpload] = useState(null)
  const [tokenUsageHistory, setTokenUsageHistory] = useState([])
  const [tokenUsageSummary, setTokenUsageSummary] = useState(null)
  const [retriedAt, setRetriedAt] = useState(null)

  const loadUpload = useCallback(async () => {
    if (!uploadId) return

    try {
      setLoading(true)
      setError(null)
      const payload = await adminFetchJson(`${API_BASE}/admin/uploads/${uploadId}`, 'Failed to load upload details')

      setUpload(payload.upload || null)
      setTokenUsageHistory(payload.tokenUsageHistory || [])
      setTokenUsageSummary(payload.tokenUsageSummary || null)
      setRetriedAt(payload.retriedAt || null)
    } catch (err) {
      setError(getMappedError(err, 'Uploads data could not be loaded.'))
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
      setError(null)

      const payload = await adminFetchJson(`${API_BASE}/admin/uploads/${uploadId}/retry`, { method: 'POST' })

      await loadUpload()
      return payload
    } catch (err) {
      setError(getMappedError(err, 'Uploads data could not be loaded.'))
      return { ok: false, error: getMappedError(err, 'Retry failed.') }
    } finally {
      setRetrying(false)
    }
  }, [loadUpload, uploadId])

  return {
    loading,
    retrying,
    error,
    upload,
    tokenUsageHistory,
    tokenUsageSummary,
    retriedAt,
    retryParsing,
    reload: loadUpload,
  }
}
