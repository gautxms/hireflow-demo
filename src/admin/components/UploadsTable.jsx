import { EmptyState, TableSkeleton } from './WidgetState'
import { useMemo, useState } from 'react'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatSecondsFromMs(value) {
  return `${(Number(value || 0) / 1000).toFixed(2)}s`
}

function statusStyles(status) {
  if (status === 'complete') return 'admin-inline-alert--success'
  if (status === 'failed') return 'admin-inline-alert--error'
  if (status === 'processing') return 'admin-inline-alert--warning'
  return 'admin-inline-alert--info'
}

export default function UploadsTable({ uploads, loading, pagination, onPageChange, onPageSizeChange, onOpenDetails }) {
  const [sortConfig, setSortConfig] = useState({ key: 'createdAt', direction: 'desc' })

  const sortedUploads = useMemo(() => {
    const source = [...uploads]
    source.sort((left, right) => {
      const leftValue = left[sortConfig.key]
      const rightValue = right[sortConfig.key]

      if (sortConfig.key === 'createdAt') {
        return sortConfig.direction === 'asc'
          ? new Date(leftValue).getTime() - new Date(rightValue).getTime()
          : new Date(rightValue).getTime() - new Date(leftValue).getTime()
      }

      if (sortConfig.key === 'parseDurationMs') {
        return sortConfig.direction === 'asc'
          ? Number(leftValue || 0) - Number(rightValue || 0)
          : Number(rightValue || 0) - Number(leftValue || 0)
      }

      const normalizedLeft = String(leftValue || '').toLowerCase()
      const normalizedRight = String(rightValue || '').toLowerCase()
      if (normalizedLeft === normalizedRight) return 0

      const result = normalizedLeft > normalizedRight ? 1 : -1
      return sortConfig.direction === 'asc' ? result : result * -1
    })
    return source
  }, [sortConfig, uploads])

  const changeSort = (key) => {
    setSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key, direction: 'asc' }
    })
  }

  return (
    <div className="admin-table-surface overflow-hidden">
      <table className="admin-table text-left text-sm">
        <thead className="">
          <tr>
            <th className="px-4 py-3"><button className="font-medium" onClick={() => changeSort('filename')}>Filename</button></th>
            <th className="px-4 py-3"><button className="font-medium" onClick={() => changeSort('userEmail')}>User Email</button></th>
            <th className="px-4 py-3"><button className="font-medium" onClick={() => changeSort('parseStatus')}>Status</button></th>
            <th className="px-4 py-3"><button className="font-medium" onClick={() => changeSort('createdAt')}>Created At</button></th>
            <th className="px-4 py-3"><button className="font-medium" onClick={() => changeSort('parseDurationMs')}>Parse Time</button></th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <TableSkeleton columns={6} rows={5} />
          ) : sortedUploads.length === 0 ? (
            <tr><td colSpan={6} className="p-4"><EmptyState title="No uploads found" description="No upload records match these filters." /></td></tr>
          ) : (
            sortedUploads.map((upload) => (
              <tr
                key={upload.id}
                className="cursor-pointer  hover:bg-[var(--color-white-alpha-03)]"
                onClick={() => onOpenDetails(upload.id)}
              >
                <td className="px-4 py-3">{upload.filename}</td>
                <td className="px-4 py-3">{upload.userEmail || `User #${upload.userId}`}</td>
                <td className="px-4 py-3">
                  <span className={`admin-inline-alert inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles(upload.parseStatus)}`}>
                    {upload.parseStatus}
                  </span>
                </td>
                <td className="px-4 py-3">{formatDate(upload.createdAt)}</td>
                <td className="px-4 py-3">{formatSecondsFromMs(upload.parseDurationMs)}</td>
                <td className="px-4 py-3">
                  <button
                    className="ui-btn px-2 py-1 text-xs"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenDetails(upload.id)
                    }}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--admin-border)] px-4 py-3 text-sm">
        <p className="text-[var(--admin-text-muted)]">
          Page {pagination.page} of {pagination.totalPages} · {pagination.total} uploads
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="pageSize" className="text-[var(--admin-text-muted)]">Rows</label>
          <select
            id="pageSize"
            className="ui-input"
            value={pagination.pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <button
            className="ui-btn ui-btn--ghost px-2 py-1 disabled:opacity-50"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          >
            Previous
          </button>
          <button
            className="ui-btn ui-btn--ghost px-2 py-1 disabled:opacity-50"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
