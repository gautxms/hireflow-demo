import { useEffect, useMemo } from 'react'
import WebhookAudit from '../components/WebhookAudit'
import useAdminLogs from '../hooks/useAdminLogs'
import API_BASE from '../../config/api'
import StateAlert from '../components/StateAlert'
import AdminDataTable from '../components/table/AdminDataTable'
import useSharedTableState from '../hooks/useSharedTableState'

const COLUMN_PRESETS = [
  { id: 'default', label: 'Default columns', columns: ['createdAt', 'endpoint', 'statusCode', 'message', 'resolved'] },
  { id: 'auth', label: 'Auth events', columns: ['createdAt', 'endpoint', 'statusCode', 'message'] },
]

const FILTER_PRESETS = [
  { id: 'recent_auth_events', label: 'Recent auth events' },
]

function ErrorRateChart({ items }) {
  const points = useMemo(() => {
    const counts = items.reduce((acc, item) => {
      const key = item.endpoint || 'n/a'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    return Object.entries(counts)
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [items])

  const maxCount = Math.max(...points.map((item) => item.count), 1)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-lg font-medium">Error rate by endpoint</h3>
      {!points.length && <p className="text-sm text-slate-500">No data to visualize.</p>}
      {points.map((point) => (
        <div key={point.endpoint} className="mb-3">
          <div className="mb-1 flex justify-between text-sm">
            <span>{point.endpoint}</span>
            <strong>{point.count}</strong>
          </div>
          <div className="h-2 rounded bg-slate-100">
            <div className="h-2 rounded bg-rose-500" style={{ width: `${(point.count / maxCount) * 100}%` }} />
          </div>
        </div>
      ))}
    </section>
  )
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function AdminLogsPage() {
  const {
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
  } = useAdminLogs()

  const {
    savedFilterChips,
    saveChip,
    removeChip,
    activePreset,
    setActivePreset,
  } = useSharedTableState({ storageKey: 'admin-logs-table' })

  useEffect(() => {
    refreshWebhooks()
  }, [refreshWebhooks])

  const endpointOptions = useMemo(() => {
    const unique = new Set(items.map((item) => item.endpoint).filter(Boolean))
    return [...unique].sort()
  }, [items])

  const statusOptions = useMemo(() => {
    const unique = new Set(items.map((item) => item.statusCode).filter(Boolean))
    return [...unique].sort((a, b) => String(a).localeCompare(String(b)))
  }, [items])

  const updateFilter = (patch) => {
    setFilters((current) => ({ ...current, ...patch, page: patch.page || 1 }))
  }

  const handleResolve = async (id) => {
    await fetch(`${API_BASE}/admin/logs/errors/${id}/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ resolvedBy: 'admin-ui' }),
    })

    refreshLogs()
  }

  const [sortField, sortDirection] = (filters.sort || 'createdAt:desc').split(':')
  const sortedItems = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
      const left = a[sortField]
      const right = b[sortField]
      if (sortField === 'createdAt') return (new Date(left || 0).getTime() - new Date(right || 0).getTime()) * direction
      return String(left || '').localeCompare(String(right || '')) * direction
    })
  }, [items, sortDirection, sortField])

  const visibleColumnKeys = useMemo(() => COLUMN_PRESETS.find((preset) => preset.id === activePreset)?.columns || COLUMN_PRESETS[0].columns, [activePreset])
  const allColumns = useMemo(() => ([
    { key: 'createdAt', label: 'Created', sortable: true, render: (row) => dateLabel(row.createdAt) },
    { key: 'endpoint', label: 'Endpoint', sortable: true },
    { key: 'statusCode', label: 'Status', sortable: true },
    { key: 'message', label: 'Message', sortable: true },
    { key: 'resolved', label: 'Resolved', sortable: true, render: (row) => (row.resolved ? 'Yes' : 'No') },
  ]), [])
  const columns = allColumns.filter((column) => visibleColumnKeys.includes(column.key))

  return (
    <main className="mx-auto grid max-w-7xl gap-4 p-5">
      <h1 className="text-2xl font-semibold text-slate-900">Admin error logs</h1>

      {error ? <StateAlert state={error} onRetry={() => void refreshLogs()} /> : null}
      <AdminDataTable
        title="Application Errors"
        subtitle="Search, filter, and inspect stack traces across error events."
        columns={columns}
        rows={sortedItems}
        loading={loading}
        rowKey={(row) => row.id}
        searchValue={filters.search}
        onSearchChange={(value) => updateFilter({ search: value })}
        searchPlaceholder="Search error message"
        filterControls={(
          <>
            <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={filters.endpoint} onChange={(event) => updateFilter({ endpoint: event.target.value })}>
              <option value="">All endpoints</option>
              {endpointOptions.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
            </select>
            <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={filters.statusCode} onChange={(event) => updateFilter({ statusCode: event.target.value })}>
              <option value="">All statuses</option>
              {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <input type="date" className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={filters.startDate} onChange={(event) => updateFilter({ startDate: event.target.value })} />
            <input type="date" className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={filters.endDate} onChange={(event) => updateFilter({ endDate: event.target.value })} />
          </>
        )}
        sort={{ field: sortField, direction: sortDirection || 'desc' }}
        onSortChange={(field) => {
          const nextDirection = sortField === field && sortDirection === 'asc' ? 'desc' : 'asc'
          updateFilter({ sort: `${field}:${nextDirection}` })
        }}
        pagination={{ page: filters.page, totalPages: pages, total, pageSize: filters.pageSize }}
        onPageChange={(page) => updateFilter({ page })}
        onPageSizeChange={(pageSize) => updateFilter({ pageSize })}
        filterPresets={FILTER_PRESETS}
        onApplyFilterPreset={(presetId) => {
          if (presetId !== 'recent_auth_events') return
          const start = new Date()
          start.setDate(start.getDate() - 3)
          updateFilter({ endpoint: '/auth/login', startDate: start.toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) })
        }}
        savedFilterChips={savedFilterChips}
        onSaveFilterChip={(label) => saveChip(label, filters)}
        onApplySavedFilter={(chipId) => {
          const chip = savedFilterChips.find((item) => item.id === chipId)
          if (!chip) return
          updateFilter(chip.filters)
        }}
        onRemoveSavedFilter={removeChip}
        columnPresets={COLUMN_PRESETS}
        activePreset={activePreset}
        onPresetChange={setActivePreset}
        renderDetails={(row) => (
          <div className="space-y-3 text-sm">
            <p><strong>Endpoint:</strong> {row.endpoint || '—'}</p>
            <p><strong>Status:</strong> {row.statusCode || '—'}</p>
            <p><strong>Message:</strong> {row.message || '—'}</p>
            <p><strong>Created:</strong> {dateLabel(row.createdAt)}</p>
            <pre className="max-h-64 overflow-auto rounded-md bg-slate-100 p-3 text-xs">{row.stack || 'No stack trace'}</pre>
            {!row.resolved ? <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5" onClick={() => void handleResolve(row.id)}>Mark resolved</button> : null}
          </div>
        )}
      />

      <ErrorRateChart items={items} />
      <WebhookAudit items={webhooks} loading={webhookLoading} error={webhookError} onRetry={() => void refreshWebhooks()} />
    </main>
  )
}
