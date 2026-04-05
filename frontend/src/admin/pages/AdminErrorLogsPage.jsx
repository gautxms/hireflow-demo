import { useCallback, useEffect, useMemo, useState } from 'react'

function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 7)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

function prettyJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2)
  } catch {
    return '{}'
  }
}

export default function AdminErrorLogsPage() {
  const defaults = useMemo(() => getDefaultDateRange(), [])
  const [filters, setFilters] = useState({
    search: '',
    endpoint: '',
    statusCode: '',
    ...defaults,
    page: 1,
    pageSize: 20,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0, retentionDays: 30 })
  const [selectedError, setSelectedError] = useState(null)

  const loadErrors = useCallback(async (overrideFilters = filters, { silent = false } = {}) => {
    try {
      if (!silent) setLoading(true)
      setError('')
      const params = new URLSearchParams({
        search: overrideFilters.search,
        endpoint: overrideFilters.endpoint,
        statusCode: overrideFilters.statusCode,
        startDate: overrideFilters.startDate,
        endDate: overrideFilters.endDate,
        page: String(overrideFilters.page),
        pageSize: String(overrideFilters.pageSize),
      })
      const response = await fetch(`/api/admin/logs/errors?${params.toString()}`, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to load error logs')
      const payload = await response.json()
      setRows(payload.items || [])
      setMeta({ page: payload.page, pages: payload.pages, total: payload.total, retentionDays: payload.retentionDays })
    } catch (err) {
      setError(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void loadErrors(filters)
    const intervalId = window.setInterval(() => {
      void loadErrors(filters, { silent: true })
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [filters, loadErrors])

  const openError = async (errorId) => {
    setSelectedError({ loading: true })
    try {
      const response = await fetch(`/api/admin/logs/errors/${errorId}`, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to load error details')
      const payload = await response.json()
      setSelectedError(payload)
    } catch (err) {
      setSelectedError({ error: err.message })
    }
  }

  const markResolved = async (errorId) => {
    try {
      const response = await fetch(`/api/admin/logs/errors/${errorId}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ resolvedBy: 'admin-dashboard' }),
      })

      if (!response.ok) throw new Error('Failed to mark error as resolved')

      await loadErrors(filters)
      if (selectedError?.id === errorId) {
        await openError(errorId)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const onApplyFilters = (event) => {
    event.preventDefault()
    setFilters((current) => ({ ...current, page: 1 }))
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Admin Error Logs</h1>
        <p className="text-sm text-slate-500">Real-time exception tracking with 30-day retention and stack traces.</p>
      </header>

      <form onSubmit={onApplyFilters} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-6">
        <label className="text-sm text-slate-700 md:col-span-2">Search message
          <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Type error text" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm text-slate-700">Endpoint
          <input value={filters.endpoint} onChange={(event) => setFilters((current) => ({ ...current, endpoint: event.target.value }))} placeholder="/api/uploads" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm text-slate-700">Status code
          <input value={filters.statusCode} onChange={(event) => setFilters((current) => ({ ...current, statusCode: event.target.value }))} placeholder="500" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm text-slate-700">Start date
          <input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm text-slate-700">End date
          <input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
        </label>
        <div className="flex items-end md:col-span-6">
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Apply filters</button>
        </div>
      </form>

      {loading ? <p className="text-slate-600">Loading error logs…</p> : null}
      {error ? <p className="text-rose-600">{error}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-900">Recent errors</h2>
          <span className="text-xs text-slate-500">Total: {meta.total} · Retention: {meta.retentionDays} days</span>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Message</th>
                <th className="py-2 pr-3">Endpoint</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Affected users</th>
                <th className="py-2 pr-3">Resolved</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-3 max-w-sm truncate" title={row.message}>{row.message}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.endpoint}</td>
                  <td className="py-2 pr-3">{row.statusCode}</td>
                  <td className="py-2 pr-3">{row.affectedUsers}</td>
                  <td className="py-2 pr-3">{row.resolved ? 'Yes' : 'No'}</td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-2">
                      <button onClick={() => void openError(row.id)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">View</button>
                      {!row.resolved ? <button onClick={() => void markResolved(row.id)} className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50">Resolve</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
          <span>Page {meta.page} of {meta.pages}</span>
          <div className="flex gap-2">
            <button disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">Prev</button>
            <button disabled={filters.page >= meta.pages} onClick={() => setFilters((current) => ({ ...current, page: Math.min(meta.pages, current.page + 1) }))} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">Next</button>
          </div>
        </div>
      </section>

      {selectedError ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium text-slate-900">Error details</h2>
            <button onClick={() => setSelectedError(null)} className="rounded border border-slate-300 px-2 py-1 text-xs">Close</button>
          </div>
          {selectedError.loading ? <p className="text-sm text-slate-500">Loading details…</p> : null}
          {selectedError.error ? <p className="text-sm text-rose-600">{selectedError.error}</p> : null}
          {selectedError.id ? (
            <div className="space-y-3 text-sm">
              <p><strong>Message:</strong> {selectedError.message}</p>
              <p><strong>Source:</strong> {selectedError.source}</p>
              <p><strong>Created:</strong> {new Date(selectedError.createdAt).toLocaleString()}</p>
              <div>
                <h3 className="mb-1 font-medium">Stack trace</h3>
                <pre className="max-h-72 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{selectedError.stack || 'No stack trace available.'}</pre>
              </div>
              <div>
                <h3 className="mb-1 font-medium">Request context</h3>
                <pre className="max-h-72 overflow-auto rounded bg-slate-100 p-3 text-xs">{prettyJson(selectedError.context)}</pre>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
