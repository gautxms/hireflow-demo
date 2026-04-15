import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'

const DEFAULT_PAGE_SIZE = 20

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
  const [error, setError] = useState('')
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookError, setWebhookError] = useState('')

  const [filters, setFilters] = useState({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    search: '',
    endpoint: '',
    statusCode: '',
    startDate: '',
    endDate: '',
    ...initialFilters,
  })

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
    setError('')

    try {
      const response = await fetch(`${API_BASE}/admin/logs/errors?${query}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to fetch error logs')
      }

      const payload = await response.json()
      setItems(payload.items || [])
      setTotal(Number(payload.total || 0))
      setPages(Number(payload.pages || 1))
    } catch (fetchError) {
      setError(fetchError.message || 'Failed to load logs')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [query])

  const refreshWebhooks = useCallback(async (page = 1) => {
    setWebhookLoading(true)
    setWebhookError('')

    try {
      const response = await fetch(`${API_BASE}/admin/logs/webhooks?page=${page}&pageSize=20`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to fetch webhook audit trail')
      }

      const payload = await response.json()
      setWebhooks(payload.items || [])
    } catch (fetchError) {
      setWebhookError(fetchError.message || 'Failed to load webhook history')
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
