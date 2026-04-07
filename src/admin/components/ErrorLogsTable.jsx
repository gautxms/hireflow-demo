import { Fragment, useMemo, useState } from 'react'

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const headerStyle = {
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  padding: '0.75rem',
  fontSize: '0.8rem',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}

const cellStyle = {
  borderBottom: '1px solid #f3f4f6',
  padding: '0.75rem',
  fontSize: '0.92rem',
  verticalAlign: 'top',
}

export default function ErrorLogsTable({ items, loading, onResolve }) {
  const [expandedId, setExpandedId] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: 'createdAt', direction: 'desc' })

  const sortedItems = useMemo(() => {
    const list = [...items]
    const { key, direction } = sortConfig

    list.sort((a, b) => {
      const left = a[key] ?? ''
      const right = b[key] ?? ''

      if (key === 'createdAt') {
        const leftTime = new Date(left).getTime()
        const rightTime = new Date(right).getTime()
        return direction === 'asc' ? leftTime - rightTime : rightTime - leftTime
      }

      if (typeof left === 'number' && typeof right === 'number') {
        return direction === 'asc' ? left - right : right - left
      }

      return direction === 'asc'
        ? String(left).localeCompare(String(right))
        : String(right).localeCompare(String(left))
    })

    return list
  }, [items, sortConfig])

  const toggleSort = (key) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  if (loading) {
    return <p style={{ color: '#6b7280' }}>Loading logs…</p>
  }

  if (!sortedItems.length) {
    return <p style={{ color: '#6b7280' }}>No errors found for current filters.</p>
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={headerStyle}><button type='button' onClick={() => toggleSort('createdAt')}>Timestamp</button></th>
            <th style={headerStyle}><button type='button' onClick={() => toggleSort('endpoint')}>Endpoint</button></th>
            <th style={headerStyle}><button type='button' onClick={() => toggleSort('statusCode')}>Status</button></th>
            <th style={headerStyle}>Message</th>
            <th style={headerStyle}><button type='button' onClick={() => toggleSort('affectedUsers')}>Affected users</button></th>
            <th style={headerStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item) => {
            const isExpanded = expandedId === item.id

            return (
              <Fragment key={item.id}>
                <tr onClick={() => setExpandedId(isExpanded ? null : item.id)} style={{ cursor: 'pointer', background: isExpanded ? '#f9fafb' : 'transparent' }}>
                  <td style={cellStyle}>{formatTime(item.createdAt)}</td>
                  <td style={cellStyle}>{item.endpoint || 'n/a'}</td>
                  <td style={cellStyle}>{item.statusCode || 'n/a'}</td>
                  <td style={cellStyle}>{item.message}</td>
                  <td style={cellStyle}>{item.affectedUsers}</td>
                  <td style={cellStyle}>
                    {item.resolved ? (
                      <span style={{ color: '#059669', fontWeight: 600 }}>Resolved</span>
                    ) : (
                      <button
                        type='button'
                        onClick={(event) => {
                          event.stopPropagation()
                          onResolve(item.id)
                        }}
                      >
                        Mark resolved
                      </button>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={6} style={{ ...cellStyle, background: '#0f172a', color: '#e2e8f0' }}>
                      <strong>Stack trace</strong>
                      <pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{item.stack || 'No stack trace captured.'}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
