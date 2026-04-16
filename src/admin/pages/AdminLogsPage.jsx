import { useEffect, useMemo } from 'react'
import ErrorLogsTable from '../components/ErrorLogsTable'
import WebhookAudit from '../components/WebhookAudit'
import useAdminLogs from '../hooks/useAdminLogs'
import API_BASE from '../../config/api'
import StateAlert from '../components/StateAlert'

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
    <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Error rate by endpoint</h3>
      {!points.length && <p style={{ color: '#6b7280' }}>No data to visualize.</p>}
      {points.map((point) => (
        <div key={point.endpoint} style={{ marginBottom: '0.6rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span>{point.endpoint}</span>
            <strong>{point.count}</strong>
          </div>
          <div style={{ height: 8, background: '#f3f4f6', borderRadius: 8 }}>
            <div style={{ width: `${(point.count / maxCount) * 100}%`, height: '100%', background: '#ef4444', borderRadius: 8 }} />
          </div>
        </div>
      ))}
    </section>
  )
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

  const updateFilter = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? value : 1,
    }))
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

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '1.25rem', display: 'grid', gap: '1rem' }}>
      <h1 style={{ marginBottom: 0 }}>Admin error logs</h1>
      <p style={{ marginTop: 0, color: '#6b7280' }}>Search, filter, and inspect stack traces across error events.</p>

      <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.6rem' }}>
          <input placeholder='Search message' value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} />
          <select value={filters.endpoint} onChange={(event) => updateFilter('endpoint', event.target.value)}>
            <option value=''>All endpoints</option>
            {endpointOptions.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
          </select>
          <select value={filters.statusCode} onChange={(event) => updateFilter('statusCode', event.target.value)}>
            <option value=''>All statuses</option>
            {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <input type='date' value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
          <input type='date' value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
        </div>
      </section>

      {error ? <StateAlert state={error} onRetry={() => void refreshLogs()} /> : null}
      <ErrorLogsTable items={items} loading={loading} onResolve={handleResolve} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#6b7280' }}>Total errors: {total}</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button type='button' disabled={filters.page <= 1} onClick={() => updateFilter('page', filters.page - 1)}>Previous</button>
          <span>Page {filters.page} / {pages}</span>
          <button type='button' disabled={filters.page >= pages} onClick={() => updateFilter('page', filters.page + 1)}>Next</button>
        </div>
      </div>

      <ErrorRateChart items={items} />
      <WebhookAudit items={webhooks} loading={webhookLoading} error={webhookError} onRetry={() => void refreshWebhooks()} />
    </main>
  )
}
