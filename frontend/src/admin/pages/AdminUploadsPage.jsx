import { useCallback, useEffect, useMemo, useState } from 'react'

const STATUS_OPTIONS = ['all', 'pending', 'processing', 'complete', 'failed']

function statusStyles(status) {
  if (status === 'complete') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 border-rose-200'
  if (status === 'processing') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatSeconds(value) {
  return `${Number(value || 0).toFixed(2)}s`
}

export default function AdminUploadsPage({ onOpenDetails }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState([])
  const [stats, setStats] = useState(null)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
  const [filters, setFilters] = useState({
    status: 'all',
    search: '',
    startDate: '',
    endDate: '',
  })

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(pagination.page),
      pageSize: String(pagination.pageSize),
    })

    if (filters.status && filters.status !== 'all') params.set('status', filters.status)
    if (filters.search.trim()) params.set('search', filters.search.trim())
    if (filters.startDate) params.set('startDate', filters.startDate)
    if (filters.endDate) params.set('endDate', filters.endDate)

    return params.toString()
  }, [filters, pagination.page, pagination.pageSize])

  const loadUploads = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const [listRes, statsRes] = await Promise.all([
        fetch(`/api/admin/uploads?${queryString}`, { credentials: 'include' }),
        fetch(`/api/admin/uploads/stats?${queryString}`, { credentials: 'include' }),
      ])

      if (!listRes.ok) throw new Error('Failed to load uploads')
      if (!statsRes.ok) throw new Error('Failed to load upload stats')

      const listPayload = await listRes.json()
      const statsPayload = await statsRes.json()

      setUploads(listPayload.uploads || [])
      setPagination((current) => ({ ...current, ...(listPayload.pagination || {}) }))
      setStats(statsPayload)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    void loadUploads()
  }, [loadUploads])

  const openDetails = (uploadId) => {
    if (typeof onOpenDetails === 'function') {
      onOpenDetails(uploadId)
      return
    }

    window.location.href = `/admin/uploads/${uploadId}`
  }

  const exportCsvUrl = `/api/admin/uploads/export?${queryString}`

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

      {stats ? (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Total parses</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{stats.totalParses}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Success %</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-700">{Number(stats.successRate || 0).toFixed(2)}%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Avg parse time</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatSeconds(stats.avgTimeSeconds)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Failure count</p>
            <p className="mt-1 text-2xl font-semibold text-rose-700">{stats.failures?.total || 0}</p>
          </div>
        </div>
      ) : null}

      {stats ? (
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
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            type="text"
            placeholder="Search filename"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={filters.search}
            onChange={(event) => {
              setPagination((current) => ({ ...current, page: 1 }))
              setFilters((current) => ({ ...current, search: event.target.value }))
            }}
          />
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={filters.status}
            onChange={(event) => {
              setPagination((current) => ({ ...current, page: 1 }))
              setFilters((current) => ({ ...current, status: event.target.value }))
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <input
            type="date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={filters.startDate}
            onChange={(event) => {
              setPagination((current) => ({ ...current, page: 1 }))
              setFilters((current) => ({ ...current, startDate: event.target.value }))
            }}
          />
          <input
            type="date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={filters.endDate}
            onChange={(event) => {
              setPagination((current) => ({ ...current, page: 1 }))
              setFilters((current) => ({ ...current, endDate: event.target.value }))
            }}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">Filename</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Flags</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-4 text-slate-500">Loading uploads…</td></tr>
            ) : uploads.map((upload) => (
              <tr key={upload.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{upload.filename}</td>
                <td className="px-4 py-3">{upload.userEmail || `User #${upload.userId}`}</td>
                <td className="px-4 py-3">{formatDate(upload.createdAt)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles(upload.parseStatus)}`}>
                    {upload.parseStatus}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {upload.suspicious ? (
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-700">
                      {upload.suspiciousReasons.join(', ')}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3">
                  <button
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => openDetails(upload.id)}
                  >
                    View details
                  </button>
                </td>
              </tr>
            ))}
            {!loading && !uploads.length ? (
              <tr><td colSpan={6} className="px-4 py-4 text-slate-500">No uploads found.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Page {pagination.page} of {Math.max(pagination.totalPages || 1, 1)} · {pagination.total} total uploads
        </p>
        <div className="flex gap-2">
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pagination.page <= 1}
            onClick={() => setPagination((current) => ({ ...current, page: Math.max(current.page - 1, 1) }))}
          >
            Previous
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pagination.page >= (pagination.totalPages || 1)}
            onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
