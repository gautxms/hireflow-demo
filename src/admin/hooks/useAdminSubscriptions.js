import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { adminFetchJson, getMappedError } from '../utils/adminErrorState'

const DEFAULT_FILTERS = { status: 'all', plan: 'all' }

function normalize(value) { return value ? String(value).toLowerCase() : '' }

function sortSubscriptions(items, sort) {
  const sorted = [...items]
  const direction = sort.direction === 'asc' ? 1 : -1
  sorted.sort((a, b) => {
    if (sort.field === 'renewalDate') return (new Date(a.renewalDate || 0).getTime() - new Date(b.renewalDate || 0).getTime()) * direction
    if (sort.field === 'email') return a.email.localeCompare(b.email) * direction
    return normalize(a[sort.field]).localeCompare(normalize(b[sort.field])) * direction
  })
  return sorted
}

export default function useAdminSubscriptions() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort] = useState({ field: 'renewalDate', direction: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [subscriptions, setSubscriptions] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedDetails, setSelectedDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadSubscriptions = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const payload = await adminFetchJson(`${API_BASE}/admin/subscriptions`, 'Failed to load subscriptions')
      setSubscriptions(payload.subscriptions || [])
    } catch (err) { setError(getMappedError(err, 'Subscriptions could not be loaded.')) }
    finally { setLoading(false) }
  }, [])

  const loadDetails = useCallback(async (subscriptionId) => {
    if (!subscriptionId) return
    try {
      setDetailsLoading(true); setError(null)
      const payload = await adminFetchJson(`${API_BASE}/admin/subscriptions/${subscriptionId}`, 'Failed to load subscription details')
      setSelectedDetails(payload); setSelectedId(subscriptionId)
    } catch (err) { setError(getMappedError(err, 'Subscription details could not be loaded.')) }
    finally { setDetailsLoading(false) }
  }, [])

  useEffect(() => { void loadSubscriptions() }, [loadSubscriptions])

  const filteredSubscriptions = useMemo(() => sortSubscriptions(subscriptions.filter((item) => (filters.status === 'all' || normalize(item.status) === filters.status) && (filters.plan === 'all' || normalize(item.plan) === filters.plan)), sort), [filters.plan, filters.status, sort, subscriptions])
  const paginatedSubscriptions = useMemo(() => filteredSubscriptions.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), [filteredSubscriptions, page, pageSize])
  const pageCount = useMemo(() => (!filteredSubscriptions.length ? 1 : Math.ceil(filteredSubscriptions.length / pageSize)), [filteredSubscriptions.length, pageSize])

  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  return { filters, setFilters, sort, setSort, page, setPage, pageSize, setPageSize, pageCount, loading, detailsLoading, error, subscriptions: paginatedSubscriptions, totalSubscriptions: filteredSubscriptions.length, selectedId, selectedDetails, refreshSubscriptions: loadSubscriptions, loadDetails }
}
