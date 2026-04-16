import UploadsTable from '../components/UploadsTable'
import StateAlert from '../components/StateAlert'
import { EmptyState } from '../components/WidgetState'
import { useAdminUploads } from '../hooks/useAdminUploads'

const STATUS_OPTIONS = ['all', 'pending', 'processing', 'complete', 'failed']

function formatSeconds(value) {
  return `${Number(value || 0).toFixed(2)}s`
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

  const openDetails = (uploadId) => {
    if (typeof onOpenDetails === 'function') {
      onOpenDetails(uploadId)
      return
    }

    window.location.href = `/admin/uploads/${uploadId}`
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Admin Resume Upload Monitoring</h1>
        <a
          href={exportCsvUrl}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export CSV Logs
        </a>
      </div>

      {loadingStats ? <p className="text-sm text-slate-500">Loading stats…</p> : null}
      {stats ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Total parses" value={stats.totalParses} />
            <StatCard label="Success %" value={`${Number(stats.successRate || 0).toFixed(2)}%`} valueClassName="text-emerald-700" />
            <StatCard label="Avg parse time" value={formatSeconds(stats.avgTimeSeconds)} />
            <StatCard label="Failure count" value={stats.failures?.total || 0} valueClassName="text-rose-700" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-medium text-slate-900">Failure breakdown</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {(stats.failures?.breakdown || []).map((item) => (
                  <li key={`${item.reason}-${item.sampleMessage || 'none'}`} className="flex justify-between rounded border border-slate-100 px-3 py-2">
                    <span>{item.reason}</span>
                    <span className="font-medium text-slate-700">{item.count}</span>
                  </li>
                ))}
                {!stats.failures?.breakdown?.length ? <li className="text-slate-500">No failures in selected range.</li> : null}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-medium text-slate-900">Format breakdown</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {(stats.formatBreakdown || []).map((item) => (
                  <li key={item.mimeType} className="flex justify-between rounded border border-slate-100 px-3 py-2">
                    <span>{item.format}</span>
                    <span className="font-medium text-slate-700">{item.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            type="text"
            placeholder="Search filename or email"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
          />
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={filters.status}
            onChange={(event) => updateFilters({ status: event.target.value })}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <input
            type="date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={filters.startDate}
            onChange={(event) => updateFilters({ startDate: event.target.value })}
          />
          <input
            type="date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={filters.endDate}
            onChange={(event) => updateFilters({ endDate: event.target.value })}
          />
        </div>
      </div>

      {error ? <StateAlert state={error} onRetry={() => void reload()} /> : null}

      {!loadingList && !error && !uploads.length ? (
        <EmptyState title="No uploads found" description="No upload records match the current filters." />
      ) : null}

      <UploadsTable
        uploads={uploads}
        loading={loadingList}
        pagination={pagination}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onOpenDetails={openDetails}
      />
    </div>
  )
}

function StatCard({ label, value, valueClassName = 'text-slate-900' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClassName}`}>{value}</p>
    </div>
  )
}
