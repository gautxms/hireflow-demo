import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { adminFetchJson, getMappedError } from '../utils/adminErrorState'

const DEFAULT_PAGE_SIZE = 20

function getInitialFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return {
    page: Number(params.get('page') || 1),
    pageSize: Number(params.get('pageSize') || DEFAULT_PAGE_SIZE),
    search: params.get('search') || '',
    endpoint: params.get('endpoint') || '',
    statusCode: params.get('statusCode') || '',
    startDate: params.get('startDate') || '',
    endDate: params.get('endDate') || '',
  }
}

function toIsoOrEmpty(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export default function useAdminLogs(initialFilters = {}) {
  const [items, setItems] = useState([])
  const [webhooks, setWebhooks] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookError, setWebhookError] = useState(null)

  const [filters, setFilters] = useState(() => ({
    ...getInitialFiltersFromUrl(),
    ...initialFilters,
  }))

  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(filters.page || 1))
    params.set('pageSize', String(filters.pageSize || DEFAULT_PAGE_SIZE))
    if (filters.search?.trim()) params.set('search', filters.search.trim())
    if (filters.endpoint?.trim()) params.set('endpoint', filters.endpoint.trim())
    if (filters.statusCode?.trim()) params.set('statusCode', filters.statusCode.trim())

    const startIso = toIsoOrEmpty(filters.startDate)
    const endIso = toIsoOrEmpty(filters.endDate)
    if (startIso) params.set('startDate', startIso)
    if (endIso) params.set('endDate', endIso)

    return params.toString()
  }, [filters])

  const refreshLogs = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const payload = await adminFetchJson(`${API_BASE}/admin/logs/errors?${query}`, 'Failed to fetch error logs')
      setItems(payload.items || [])
      setTotal(Number(payload.total || 0))
      setPages(Number(payload.pages || 1))
    } catch (fetchError) {
      setError(getMappedError(fetchError, 'Failed to load logs'))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [query])

  const refreshWebhooks = useCallback(async (page = 1) => {
    setWebhookLoading(true)
    setWebhookError(null)

    try {
      const payload = await adminFetchJson(`${API_BASE}/admin/logs/webhooks?page=${page}&pageSize=20`, 'Failed to fetch webhook audit trail')
      setWebhooks(payload.items || [])
    } catch (fetchError) {
      setWebhookError(getMappedError(fetchError, 'Failed to load webhook history'))
      setWebhooks([])
    } finally {
      setWebhookLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshLogs()
  }, [refreshLogs])

  return {
    items,
    webhooks,
    total,
    pages,
    loading,
    error,
    webhookLoading,
    webhookError,
    filters,
    setFilters,
    refreshLogs,
    refreshWebhooks,
  }
}
