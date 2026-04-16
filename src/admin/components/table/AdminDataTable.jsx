import { useMemo, useState } from 'react'
import { EmptyState, TableSkeleton } from '../WidgetState'

function SortIndicator({ active, direction }) {
  if (!active) return <span className="text-slate-300">↕</span>
  return <span>{direction === 'asc' ? '↑' : '↓'}</span>
}

function DetailsDrawer({ title, row, onClose, renderDetails }) {
  if (!row) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/35" role="dialog" aria-modal="true" aria-label={`${title} details`}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{title} details</h3>
          <button type="button" className="rounded-md border border-slate-200 px-3 py-1.5 text-sm" onClick={onClose}>Close</button>
        </div>
        {renderDetails(row)}
      </div>
    </div>
  )
}

export default function AdminDataTable({
  title,
  subtitle,
  columns,
  rows,
  loading,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search',
  filterControls,
  sort,
  onSortChange,
  pagination,
  onPageChange,
  onPageSizeChange,
  emptyTitle = 'No records found',
  emptyDescription = 'No rows match current filters.',
  csvExportUrl,
  columnPresets = [],
  activePreset,
  onPresetChange,
  filterPresets = [],
  onApplyFilterPreset,
  savedFilterChips = [],
  onSaveFilterChip,
  onApplySavedFilter,
  onRemoveSavedFilter,
  rowKey,
  renderDetails,
  onRowClick,
}) {
  const [selectedRow, setSelectedRow] = useState(null)
  const [chipName, setChipName] = useState('')

  const totalColumns = columns.length
  const visibleRows = useMemo(() => rows || [], [rows])

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {csvExportUrl ? <a href={csvExportUrl} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export CSV</a> : null}
            {columnPresets.length ? (
              <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={activePreset} onChange={(event) => onPresetChange?.(event.target.value)}>
                {columnPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {typeof onSearchChange === 'function' ? (
            <input
              type="search"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={searchPlaceholder}
              value={searchValue || ''}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          ) : null}
          {filterControls}
        </div>

        {filterPresets.length ? (
          <div className="flex flex-wrap gap-2">
            {filterPresets.map((preset) => (
              <button key={preset.id} type="button" className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => onApplyFilterPreset?.(preset.id)}>
                {preset.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Save current filters as..." value={chipName} onChange={(event) => setChipName(event.target.value)} />
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            onClick={() => {
              if (!chipName.trim()) return
              onSaveFilterChip?.(chipName.trim())
              setChipName('')
            }}
          >
            Save chip
          </button>
          {savedFilterChips.map((chip) => (
            <span key={chip.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs">
              <button type="button" onClick={() => onApplySavedFilter?.(chip.id)}>{chip.label}</button>
              <button type="button" className="text-slate-500" onClick={() => onRemoveSavedFilter?.(chip.id)}>×</button>
            </span>
          ))}
        </div>
      </header>

      <div className="overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-4 py-3 font-medium" style={column.width ? { width: column.width } : undefined}>
                  {column.sortable ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1"
                      onClick={() => onSortChange?.(column.key)}
                    >
                      <span>{column.label}</span>
                      <SortIndicator active={sort?.field === column.key} direction={sort?.direction} />
                    </button>
                  ) : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? <TableSkeleton columns={totalColumns} rows={5} /> : null}
            {!loading && !visibleRows.length ? <tr><td className="p-4" colSpan={totalColumns}><EmptyState title={emptyTitle} description={emptyDescription} /></td></tr> : null}
            {!loading && visibleRows.map((row) => (
              <tr
                key={rowKey(row)}
                className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50"
                onClick={() => { onRowClick?.(row); if (renderDetails) setSelectedRow(row) }}
              >
                {columns.map((column) => (
                  <td key={`${rowKey(row)}-${column.key}`} className="px-4 py-3 align-top text-slate-700">
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            Page {pagination.page} of {pagination.totalPages}
            {typeof pagination.total === 'number' ? ` · ${pagination.total} records` : ''}
          </span>
          <div className="flex items-center gap-2">
            {typeof onPageSizeChange === 'function' ? (
              <select className="rounded-md border border-slate-300 px-2 py-1.5" value={pagination.pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
                {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size} / page</option>)}
              </select>
            ) : null}
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50" disabled={pagination.page <= 1} onClick={() => onPageChange?.(pagination.page - 1)}>Previous</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange?.(pagination.page + 1)}>Next</button>
          </div>
        </div>
      ) : null}

      <DetailsDrawer title={title} row={selectedRow} onClose={() => setSelectedRow(null)} renderDetails={renderDetails || (() => null)} />
    </section>
  )
}
