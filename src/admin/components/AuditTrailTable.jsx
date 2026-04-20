import { useMemo, useState } from 'react'

function sortRecords(records, sortBy, sortDirection) {
  const sorted = [...records]

  sorted.sort((a, b) => {
    const aValue = String(a?.[sortBy] || '').toLowerCase()
    const bValue = String(b?.[sortBy] || '').toLowerCase()

    if (aValue < bValue) {
      return sortDirection === 'asc' ? -1 : 1
    }

    if (aValue > bValue) {
      return sortDirection === 'asc' ? 1 : -1
    }

    return 0
  })

  return sorted
}

export default function AuditTrailTable({ records = [] }) {
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('timestamp')
  const [sortDirection, setSortDirection] = useState('desc')

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = !normalizedQuery
      ? records
      : records.filter((item) => [item.adminEmail, item.action, item.location, item.ipAddress].join(' ').toLowerCase().includes(normalizedQuery))

    return sortRecords(filtered, sortBy, sortDirection)
  }, [query, records, sortBy, sortDirection])

  const updateSort = (column) => {
    if (column === sortBy) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortBy(column)
    setSortDirection('asc')
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Admin audit trail</h2>
      <p style={{ color: 'var(--admin-text-muted)' }}>Who did what, when, and from where.</p>

      <input
        type="search"
        placeholder="Filter by admin, action, location, or IP"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{ width: '100%', marginBottom: 12 }}
      />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th><button type="button" onClick={() => updateSort('adminEmail')}>Who</button></th>
              <th><button type="button" onClick={() => updateSort('action')}>What</button></th>
              <th><button type="button" onClick={() => updateSort('timestamp')}>When</button></th>
              <th><button type="button" onClick={() => updateSort('location')}>From where</button></th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {visibleRecords.map((item) => (
              <tr key={item.id}>
                <td>{item.adminEmail || 'Unknown admin'}</td>
                <td>{item.action || '—'}</td>
                <td>{item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'}</td>
                <td>{item.location || '—'}</td>
                <td>{item.ipAddress || '—'}</td>
              </tr>
            ))}
            {!visibleRecords.length ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 12, color: 'var(--admin-text-subtle)' }}>
                  No matching audit entries.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
