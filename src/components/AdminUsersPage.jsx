import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

export default function AdminUsersPage({ token }) {
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    const loadUsers = async () => {
      setLoading(true)
      setError('')

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: '10',
        })

        if (search.trim()) {
          params.set('search', search.trim())
        }

        const response = await fetch(`${API_BASE_URL}/api/admin/users?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
          signal: controller.signal,
        })

        const payload = await parseResponsePayload(response)

        if (!response.ok) {
          setError(payload?.error || `Unable to load users (${response.status})`)
          return
        }

        setUsers(payload?.users || [])
        setPagination(payload?.pagination || { page: 1, limit: 10, total: 0 })
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError('Unable to reach admin API')
        }
      } finally {
        setLoading(false)
      }
    }

    loadUsers()

    return () => controller.abort()
  }, [page, search, token])

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit))

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <h1>Admin • Users</h1>
      <p>Search and manage user accounts.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search by email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={() => navigate('/')}>Back to app</button>
      </div>

      {loading && <p>Loading users...</p>}
      {error && <p style={{ color: '#b42318' }}>{error}</p>}

      {!loading && !error && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Email</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Role</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Status</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{user.email}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{user.role}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{user.is_blocked ? 'Blocked' : 'Active'}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    <button onClick={() => navigate(`/admin/users/${user.id}`)}>View details</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button>
            <span>Page {pagination.page} of {totalPages}</span>
            <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>Next</button>
          </div>
        </>
      )}
    </main>
  )
}
