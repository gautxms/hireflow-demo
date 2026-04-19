import { useMemo } from 'react'
import StateAlert from '../components/StateAlert'
import { EmptyState } from '../components/WidgetState'
import AdminDataTable from '../components/table/AdminDataTable'
import { useAdminUploads } from '../hooks/useAdminUploads'
import useSharedTableState from '../hooks/useSharedTableState'

const STATUS_OPTIONS = ['all', 'pending', 'processing', 'complete', 'failed']

const COLUMN_PRESETS = [
  { id: 'default', label: 'Default columns', columns: ['fileName', 'userEmail', 'parseStatus', 'totalTokens', 'createdAt', 'parseDurationMs'] },
  { id: 'failures', label: 'Failure triage', columns: ['fileName', 'userEmail', 'parseStatus', 'parseError', 'createdAt'] },
  { id: 'token_usage', label: 'Token usage', columns: ['fileName', 'userEmail', 'parseStatus', 'totalTokens', 'estimatedCostUsd', 'usageAvailable', 'createdAt'] },
]

const FILTER_PRESETS = [
  { id: 'failed_today', label: 'Failed uploads today' },
]

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function sortUploads(items, sort) {
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    if (sort.field === 'totalTokens') {
      return ((Number(a.tokenUsage?.totalTokens || 0) - Number(b.tokenUsage?.totalTokens || 0)) * direction)
    }
    if (sort.field === 'estimatedCostUsd') {
      return ((Number(a.tokenUsage?.estimatedCostUsd || 0) - Number(b.tokenUsage?.estimatedCostUsd || 0)) * direction)
    }
    if (sort.field === 'usageAvailable') {
      return (String(a.tokenUsage?.usageAvailable ?? '').localeCompare(String(b.tokenUsage?.usageAvailable ?? '')) * direction)
    }
    const left = a[sort.field]
    const right = b[sort.field]
    if (sort.field === 'createdAt') {
      return (new Date(left || 0).getTime() - new Date(right || 0).getTime()) * direction
    }
    return String(left || '').localeCompare(String(right || '')) * direction
  })
}

export default function AdminUploadsPage({ onOpenDetails }) {
  const {
    filters,
    pagination,
    uploads,
    stats,
    loadingList,
    loadingStats,
    error,
    exportCsvUrl,
    setPage,
    setPageSize,
    updateFilters,
    reload,
  } = useAdminUploads()

  const {
    savedFilterChips,
    saveChip,
    removeChip,
    activePreset,
    setActivePreset,
  } = useSharedTableState({ storageKey: 'admin-uploads-table' })

  const [sortField, sortDirection] = (filters.sort || 'createdAt:desc').split(':')
  const sortedUploads = useMemo(() => sortUploads(uploads, { field: sortField, direction: sortDirection || 'desc' }), [sortDirection, sortField, uploads])

  const openDetails = (uploadId) => {
    if (typeof onOpenDetails === 'function') {
      onOpenDetails(uploadId)
      return
    }

    window.location.assign(`/admin/uploads/${uploadId}`)
  }

  const visibleColumnKeys = useMemo(() => COLUMN_PRESETS.find((preset) => preset.id === activePreset)?.columns || COLUMN_PRESETS[0].columns, [activePreset])
  const allColumns = useMemo(() => ([
    { key: 'fileName', label: 'File', sortable: true, render: (row) => row.fileName || row.filename || '—' },
    { key: 'userEmail', label: 'Email', sortable: true, render: (row) => row.userEmail || '—' },
    { key: 'parseStatus', label: 'Status', sortable: true, render: (row) => <span className="capitalize">{row.parseStatus || 'unknown'}</span> },
    { key: 'parseError', label: 'Failure', sortable: true, render: (row) => row.parseError || '—' },
    {
      key: 'usageAvailable',
      label: 'Usage',
      sortable: true,
      render: (row) => {
        if (row.tokenUsage?.usageAvailable === true) return 'available'
        if (row.tokenUsage?.usageAvailable === false) return 'missing'
        return '—'
      },
    },
    { key: 'totalTokens', label: 'Total tokens', sortable: true, render: (row) => row.tokenUsage?.totalTokens === null || row.tokenUsage?.totalTokens === undefined ? '—' : Number(row.tokenUsage.totalTokens).toLocaleString() },
    { key: 'estimatedCostUsd', label: 'Est. cost', sortable: true, render: (row) => row.tokenUsage?.estimatedCostUsd === null || row.tokenUsage?.estimatedCostUsd === undefined ? '—' : `$${Number(row.tokenUsage.estimatedCostUsd).toFixed(4)}` },
    { key: 'createdAt', label: 'Created', sortable: true, render: (row) => formatDate(row.createdAt) },
    { key: 'parseDurationMs', label: 'Parse ms', sortable: true, render: (row) => Number(row.parseDurationMs || 0).toLocaleString() },
  ]), [])
  const columns = allColumns.filter((column) => visibleColumnKeys.includes(column.key))

  return (
    <div className="admin-page">

      {loadingStats ? <p className="text-sm text-slate-500">Loading stats…</p> : null}
      {stats ? (
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Total parses" value={stats.totalParses} />
          <StatCard label="Success %" value={`${Number(stats.successRate || 0).toFixed(2)}%`} valueClassName="text-emerald-700" />
          <StatCard label="Total tokens" value={Number(stats.tokenUsage?.totalTokens || 0).toLocaleString()} />
          <StatCard label="Avg tokens/resume" value={Number(stats.tokenUsage?.avgTokensPerResume || 0).toLocaleString()} />
          <StatCard label="Token cost" value={`$${Number(stats.tokenUsage?.totalEstimatedCostUsd || 0).toFixed(4)}`} />
          <StatCard label="Avg parse time" value={`${Number(stats.avgTimeSeconds || 0).toFixed(2)}s`} />
          <StatCard label="Failure count" value={stats.failures?.total || 0} valueClassName="text-rose-700" />
          <StatCard label="Usage missing" value={stats.tokenUsage?.usageUnavailableCount || 0} />
        </div>
      ) : null}

      {error ? <StateAlert state={error} onRetry={() => void reload()} /> : null}
      {!loadingList && !error && !uploads.length ? <EmptyState title="No uploads found" description="No upload records match the current filters." /> : null}

      <AdminDataTable
        title="Uploads"
        subtitle="Monitor parse status, failures, and retry candidates."
        columns={columns}
        rows={sortedUploads}
        loading={loadingList}
        rowKey={(row) => row.id}
        csvExportUrl={exportCsvUrl}
        searchValue={filters.search}
        onSearchChange={(value) => updateFilters({ search: value })}
        searchPlaceholder="Search filename or email"
        filterControls={(
          <>
            <select className="ui-input" value={filters.status} onChange={(event) => updateFilters({ status: event.target.value })}>
              {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <input type="date" className="ui-input" value={filters.startDate} onChange={(event) => updateFilters({ startDate: event.target.value })} />
            <input type="date" className="ui-input" value={filters.endDate} onChange={(event) => updateFilters({ endDate: event.target.value })} />
          </>
        )}
        sort={{ field: sortField, direction: sortDirection || 'desc' }}
        onSortChange={(field) => {
          const nextDirection = sortField === field && sortDirection === 'asc' ? 'desc' : 'asc'
          updateFilters({ sort: `${field}:${nextDirection}` })
        }}
        pagination={pagination}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        filterPresets={FILTER_PRESETS}
        onApplyFilterPreset={(presetId) => {
          if (presetId !== 'failed_today') return
          const today = new Date().toISOString().slice(0, 10)
          updateFilters({ status: 'failed', startDate: today, endDate: today })
        }}
        savedFilterChips={savedFilterChips}
        onSaveFilterChip={(label) => saveChip(label, filters)}
        onApplySavedFilter={(chipId) => {
          const chip = savedFilterChips.find((item) => item.id === chipId)
          if (!chip) return
          updateFilters(chip.filters)
        }}
        onRemoveSavedFilter={removeChip}
        columnPresets={COLUMN_PRESETS}
        activePreset={activePreset}
        onPresetChange={setActivePreset}
        renderDetails={(upload) => (
          <div className="space-y-2 text-sm">
            <p><strong>File:</strong> {upload.fileName || upload.filename || '—'}</p>
            <p><strong>Email:</strong> {upload.userEmail || '—'}</p>
            <p><strong>Status:</strong> {upload.parseStatus || '—'}</p>
            <p><strong>Created:</strong> {formatDate(upload.createdAt)}</p>
            <p><strong>Failure reason:</strong> {upload.parseError || '—'}</p>
            <p><strong>Total tokens:</strong> {upload.tokenUsage?.totalTokens === null || upload.tokenUsage?.totalTokens === undefined ? '—' : Number(upload.tokenUsage.totalTokens).toLocaleString()}</p>
            <p><strong>Estimated cost:</strong> {upload.tokenUsage?.estimatedCostUsd === null || upload.tokenUsage?.estimatedCostUsd === undefined ? '—' : `$${Number(upload.tokenUsage.estimatedCostUsd).toFixed(4)}`}</p>
            {upload.tokenUsage?.usageAvailable === false ? <p><strong>Usage missing reason:</strong> {upload.tokenUsage?.unavailableReason || 'unknown'}</p> : null}
            <button type="button" className="ui-btn mt-2" onClick={() => openDetails(upload.id)}>
              Open full upload details
            </button>
          </div>
        )}
      />
    </div>
  )
}

function StatCard({ label, value, valueClassName = 'text-slate-900' }) {
  return (
    <div className="ui-card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClassName}`}>{value}</p>
    </div>
  )
}
