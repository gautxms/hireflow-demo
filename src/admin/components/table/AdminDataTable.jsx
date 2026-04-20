import { useMemo, useState } from 'react'
import { EmptyState, TableSkeleton } from '../WidgetState'

function SortIndicator({ active, direction }) {
  if (!active) return <span style={{ color: 'var(--admin-text-subtle)' }}>↕</span>
  return <span>{direction === 'asc' ? '↑' : '↓'}</span>
}

function DetailsDrawer({ title, row, onClose, renderDetails }) {
  if (!row) return null

  return (
    <div className="ui-modal ui-modal--end" role="dialog" aria-modal="true" aria-label={`${title} details`}>
      <div className="ui-card ui-card--card-spacing ui-modal__dialog h-full w-full max-w-xl overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{title} details</h3>
          <button type="button" className="ui-btn" onClick={onClose}>Close</button>
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
    <section className="ui-card space-y-4 p-4 md:p-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
            {subtitle ? <p className="text-sm text-slate-700">{subtitle}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {csvExportUrl ? <a href={csvExportUrl} className="ui-btn">Export CSV</a> : null}
            {columnPresets.length ? (
              <select className="ui-input" value={activePreset} onChange={(event) => onPresetChange?.(event.target.value)}>
                {columnPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {typeof onSearchChange === 'function' ? (
            <input
              type="search"
              className="ui-input md:col-span-2"
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
              <button key={preset.id} type="button" className="ui-btn" onClick={() => onApplyFilterPreset?.(preset.id)}>
                {preset.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <input className="ui-input" placeholder="Save current filters as..." value={chipName} onChange={(event) => setChipName(event.target.value)} />
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              if (!chipName.trim()) return
              onSaveFilterChip?.(chipName.trim())
              setChipName('')
            }}
          >
            Save chip
          </button>
          {savedFilterChips.map((chip) => (
            <span key={chip.id} className="ui-chip">
              <button type="button" className="ui-btn ui-btn--ghost px-2 py-1 text-xs" onClick={() => onApplySavedFilter?.(chip.id)}>{chip.label}</button>
              <button type="button" className="ui-btn px-2 py-0.5 text-xs" onClick={() => onRemoveSavedFilter?.(chip.id)} aria-label={`Remove ${chip.label} filter`}>×</button>
            </span>
          ))}
        </div>
      </header>

      <div className="admin-table-surface">
        <table className="admin-table text-left text-sm">
          <thead className="sticky top-0 z-10">
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
                className="cursor-pointer transition"
                onClick={() => { onRowClick?.(row); if (renderDetails) setSelectedRow(row) }}
              >
                {columns.map((column) => (
                  <td key={`${rowKey(row)}-${column.key}`} className="px-4 py-3 align-top">
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700">
          <span>
            Page {pagination.page} of {pagination.totalPages}
            {typeof pagination.total === 'number' ? ` · ${pagination.total} records` : ''}
          </span>
          <div className="flex items-center gap-2">
            {typeof onPageSizeChange === 'function' ? (
              <select className="ui-input" value={pagination.pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
                {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size} / page</option>)}
              </select>
            ) : null}
            <button type="button" className="ui-btn" disabled={pagination.page <= 1} onClick={() => onPageChange?.(pagination.page - 1)}>Previous</button>
            <button type="button" className="ui-btn" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange?.(pagination.page + 1)}>Next</button>
          </div>
        </div>
      ) : null}

      <DetailsDrawer title={title} row={selectedRow} onClose={() => setSelectedRow(null)} renderDetails={renderDetails || (() => null)} />
    </section>
  )
}
