import { useCallback, useMemo, useState } from 'react'

const PAGE_SIZE = 50
const SORTABLE_FIELDS = ['email', 'company', 'subscription_status', 'created_at']

function normalizeUser(user = {}) {
  return {
    id: user.id,
    email: user.email || '—',
    company: user.company || user.company_name || '—',
    phone: user.phone || user.phone_number || '',
    subscription_status: user.subscription_status || 'inactive',
    created_at: user.created_at,
    status: user.status || (user.deleted_at ? 'inactive' : (user.is_blocked ? 'blocked' : 'active')),
    is_blocked: Boolean(user.is_blocked),
    deleted_at: user.deleted_at || null,
    auditTrail: Array.isArray(user.auditTrail) ? user.auditTrail : [],
    ...user,
  }
}

function valueForSort(user, key) {
  const value = user?.[key]
  if (!value) return ''
  if (key === 'created_at') return new Date(value).getTime()
  return String(value).toLowerCase()
}

function sortUsers(users, sortBy, sortDirection) {
  const next = [...users]
  next.sort((left, right) => {
    const a = valueForSort(left, sortBy)
    const b = valueForSort(right, sortBy)
    if (a === b) return 0
    if (sortDirection === 'desc') return a > b ? -1 : 1
    return a > b ? 1 : -1
  })
  return next
}

export default function useAdminUsers() {
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDirection, setSortDirection] = useState('desc')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      const response = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to load users')
      const payload = await response.json()
      const list = Array.isArray(payload) ? payload : (payload.users || [])
      setUsers(list.map(normalizeUser))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [search])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users.filter((user) => {
      const searchable = `${user.email} ${user.company}`.toLowerCase()
      const searchPass = !query || searchable.includes(query)
      const statusPass = statusFilter === 'all' || user.status === statusFilter
      return searchPass && statusPass
    })
  }, [search, statusFilter, users])

  const sorted = useMemo(() => sortUsers(filtered, sortBy, sortDirection), [filtered, sortBy, sortDirection])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)), [sorted.length])

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return sorted.slice(start, start + PAGE_SIZE)
  }, [page, sorted])

  const setSort = useCallback((field) => {
    if (!SORTABLE_FIELDS.includes(field)) return
    setPage(1)
    setSortBy((current) => {
      if (current === field) {
        setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))
        return current
      }
      setSortDirection('asc')
      return field
    })
  }, [])

  const mutateUser = useCallback((userId, updater) => {
    setUsers((current) => current.map((user) => (user.id === userId ? normalizeUser(updater(user)) : user)))
  }, [])

  const appendAudit = useCallback((userId, event) => {
    mutateUser(userId, (user) => ({
      ...user,
      auditTrail: [{
        id: event.id || `${event.action}-${Date.now()}`,
        action: event.action,
        actor: event.actor || 'admin',
        created_at: event.created_at || new Date().toISOString(),
        details: event.details || null,
      }, ...(user.auditTrail || [])],
    }))
  }, [mutateUser])

  const updateProfile = useCallback(async (userId, updates) => {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', ...updates }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Failed to update user')

    mutateUser(userId, (user) => ({ ...user, ...updates, ...(payload.user || {}) }))
    appendAudit(userId, payload.audit || { action: 'profile_updated', details: updates })
    return payload
  }, [appendAudit, mutateUser])

  const blockUser = useCallback(async (userId, reason) => {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'block', reason, is_blocked: true }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Failed to block user')

    mutateUser(userId, (user) => ({ ...user, is_blocked: true, status: 'blocked' }))
    appendAudit(userId, payload.audit || { action: 'blocked', details: { reason } })
    return payload
  }, [appendAudit, mutateUser])

  const unblockUser = useCallback(async (userId) => {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unblock', is_blocked: false }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Failed to unblock user')

    mutateUser(userId, (user) => ({ ...user, is_blocked: false, status: 'active' }))
    appendAudit(userId, payload.audit || { action: 'unblocked' })
    return payload
  }, [appendAudit, mutateUser])

  const resetPassword = useCallback(async (userId) => {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_password', resetPassword: true }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Failed to send reset email')
    appendAudit(userId, payload.audit || { action: 'password_reset_email_sent' })
    return payload
  }, [appendAudit])

  const impersonateUser = useCallback(async (userId) => {
    const response = await fetch(`/api/admin/users/${userId}/impersonate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresInMinutes: 15 }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Failed to generate impersonation token')
    appendAudit(userId, payload.audit || { action: 'impersonation_token_created', details: { expiresInMinutes: 15 } })
    return payload
  }, [appendAudit])

  const deleteUser = useCallback(async (userId) => {
    mutateUser(userId, (user) => ({ ...user, deleted_at: new Date().toISOString(), status: 'inactive' }))
    appendAudit(userId, { action: 'soft_deleted' })
    return { ok: true }
  }, [appendAudit, mutateUser])

  const getUserById = useCallback((userId) => users.find((user) => String(user.id) === String(userId)) || null, [users])

  return {
    users: paginated,
    rawUsers: users,
    loading,
    error,
    search,
    setSearch: (value) => {
      setPage(1)
      setSearch(value)
    },
    statusFilter,
    setStatusFilter: (value) => {
      setPage(1)
      setStatusFilter(value)
    },
    sortBy,
    sortDirection,
    setSort,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    totalPages,
    totalCount: sorted.length,
    loadUsers,
    updateProfile,
    blockUser,
    unblockUser,
    resetPassword,
    impersonateUser,
    deleteUser,
    getUserById,
  }
}
