import { useCallback, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { adminFetchJson, getMappedError } from '../utils/adminErrorState'

const PAGE_SIZE = 50

function normalizeInquiry(inquiry = {}) {
  return {
    id: inquiry.id,
    inquiry_type: inquiry.inquiry_type || 'contact',
    status: inquiry.status || 'new',
    name: inquiry.name || '—',
    email: inquiry.email || '—',
    company: inquiry.company || '—',
    phone: inquiry.phone || '',
    subject: inquiry.subject || '',
    message: inquiry.message || '',
    metadata: inquiry.metadata || {},
    created_at: inquiry.created_at,
    reviewed_at: inquiry.reviewed_at,
    reviewed_by: inquiry.reviewed_by,
  }
}

export default function useAdminInquiries() {
  const [inquiries, setInquiries] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadInquiries = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (typeFilter !== 'all') params.set('type', typeFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      const payload = await adminFetchJson(`${API_BASE}/admin/inquiries?${params.toString()}`)
      const list = Array.isArray(payload.inquiries) ? payload.inquiries : []
      setInquiries(list.map(normalizeInquiry))
    } catch (err) {
      setError(getMappedError(err))
    } finally {
      setLoading(false)
    }
  }, [fromDate, search, statusFilter, toDate, typeFilter])

  const markReviewed = useCallback(async (inquiryId, status = 'reviewed') => {
    const response = await fetch(`${API_BASE}/admin/inquiries/${inquiryId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Unable to update inquiry status')

    setInquiries((current) => current.map((item) => (item.id === inquiryId ? normalizeInquiry(payload.inquiry || item) : item)))
    return payload
  }, [])

  const filtered = useMemo(() => inquiries, [inquiries])
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), [filtered.length])

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  return {
    inquiries: paginated,
    loading,
    error,
    search,
    setSearch: (value) => {
      setPage(1)
      setSearch(value)
    },
    typeFilter,
    setTypeFilter: (value) => {
      setPage(1)
      setTypeFilter(value)
    },
    statusFilter,
    setStatusFilter: (value) => {
      setPage(1)
      setStatusFilter(value)
    },
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    totalPages,
    totalCount: filtered.length,
    loadInquiries,
    markReviewed,
  }
}
