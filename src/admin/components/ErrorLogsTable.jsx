import { Fragment, useMemo, useState } from 'react'
import { EmptyState, TableSkeleton } from './WidgetState'

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const headerStyle = { textAlign: 'left', borderBottom: '1px solid var(--admin-border)', padding: '0.75rem', fontSize: '0.8rem', color: 'var(--admin-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.03em' }
const cellStyle = { borderBottom: '1px solid var(--admin-border)', padding: '0.75rem', fontSize: '0.92rem', verticalAlign: 'top' }

export default function ErrorLogsTable({ items, loading, onResolve }) {
  const [expandedId, setExpandedId] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: 'createdAt', direction: 'desc' })
  const sortedItems = useMemo(() => [...items].sort((a, b) => {
    const { key, direction } = sortConfig
    const left = a[key] ?? ''
    const right = b[key] ?? ''
    if (key === 'createdAt') return (new Date(direction === 'asc' ? left : right).getTime() - new Date(direction === 'asc' ? right : left).getTime())
    return direction === 'asc' ? String(left).localeCompare(String(right)) : String(right).localeCompare(String(left))
  }), [items, sortConfig])

  const toggleSort = (key) => setSortConfig((c) => ({ key, direction: c.key === key && c.direction === 'asc' ? 'desc' : 'asc' }))

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--admin-border)', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={headerStyle}><button type='button' onClick={() => toggleSort('createdAt')}>Timestamp</button></th>
          <th style={headerStyle}><button type='button' onClick={() => toggleSort('endpoint')}>Endpoint</button></th>
          <th style={headerStyle}><button type='button' onClick={() => toggleSort('statusCode')}>Status</button></th>
          <th style={headerStyle}>Message</th><th style={headerStyle}><button type='button' onClick={() => toggleSort('affectedUsers')}>Affected users</button></th><th style={headerStyle}>Actions</th>
        </tr></thead>
        {loading ? <TableSkeleton columns={6} rows={5} /> : (
          <tbody>
            {!sortedItems.length ? <tr><td colSpan={6} style={cellStyle}><EmptyState title="No errors found" description="Try broadening filters or changing the date range." /></td></tr> : null}
            {sortedItems.map((item) => {
              const isExpanded = expandedId === item.id
              return <Fragment key={item.id}>
                <tr onClick={() => setExpandedId(isExpanded ? null : item.id)} style={{ cursor: 'pointer', background: isExpanded ? 'var(--admin-surface-subtle)' : 'transparent' }}>
                  <td style={cellStyle}>{formatTime(item.createdAt)}</td><td style={cellStyle}>{item.endpoint || 'n/a'}</td><td style={cellStyle}>{item.statusCode || 'n/a'}</td><td style={cellStyle}>{item.message}</td><td style={cellStyle}>{item.affectedUsers}</td>
                  <td style={cellStyle}>{item.resolved ? <span style={{ color: 'var(--admin-success-text)', fontWeight: 600 }}>Resolved</span> : <button type='button' onClick={(event) => { event.stopPropagation(); onResolve(item.id) }}>Mark resolved</button>}</td>
                </tr>
                {isExpanded ? <tr><td colSpan={6} style={{ ...cellStyle, background: 'var(--admin-bg)', color: 'var(--admin-text)' }}><strong>Stack trace</strong><pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{item.stack || 'No stack trace captured.'}</pre></td></tr> : null}
              </Fragment>
            })}
          </tbody>
        )}
      </table>
    </div>
  )
}
