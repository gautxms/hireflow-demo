import { useCallback, useEffect, useState } from 'react'

function statusPill(status) {
  if (status === 'green') return 'bg-emerald-100 text-emerald-700'
  if (status === 'yellow') return 'bg-amber-100 text-amber-700'
  return 'bg-rose-100 text-rose-700'
}

export default function AdminHealthPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [health, setHealth] = useState(null)
  const [webhooks, setWebhooks] = useState([])

  const loadHealth = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true)
      setError('')

      const [healthResponse, webhookResponse] = await Promise.all([
        fetch('/api/admin/health', { credentials: 'include' }),
        fetch('/api/admin/logs/webhooks?page=1&pageSize=20', { credentials: 'include' }),
      ])

      if (!healthResponse.ok) throw new Error('Failed to fetch health metrics')
      if (!webhookResponse.ok) throw new Error('Failed to fetch webhook audit logs')

      const healthPayload = await healthResponse.json()
      const webhookPayload = await webhookResponse.json()

      setHealth(healthPayload)
      setWebhooks(webhookPayload.items || [])
    } catch (err) {
      setError(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHealth()
    const interval = window.setInterval(() => {
      void loadHealth({ silent: true })
    }, 15000)

    return () => window.clearInterval(interval)
  }, [loadHealth])

  const retryJob = async (jobId) => {
    try {
      const response = await fetch(`/api/admin/health/jobs/${jobId}/retry`, {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) throw new Error('Retry failed')
      await loadHealth({ silent: true })
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">System Health & Queue Monitor</h1>
          <p className="text-sm text-slate-500">Database, memory, CPU, webhook audit, and async job visibility.</p>
        </div>
        {health ? <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${statusPill(health.systemStatus)}`}>{health.systemStatus}</span> : null}
      </header>

      {loading ? <p className="text-slate-600">Loading health metrics…</p> : null}
      {error ? <p className="text-rose-600">{error}</p> : null}

      {health ? (
        <>
          {health.alerts?.length ? (
            <section className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-4">
              <h2 className="text-sm font-semibold text-rose-700">Active Alerts</h2>
              {health.alerts.map((alert, index) => (
                <p key={`${alert.message}-${index}`} className="text-sm text-rose-700">[{alert.severity}] {alert.message}</p>
              ))}
            </section>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">Database</h2>
              <p className="mt-2 text-lg font-semibold">{health.db.connected ? 'Connected' : 'Down'}</p>
              <p className="text-xs text-slate-500">Latency: {health.db.latencyMs ?? 'n/a'} ms</p>
              <p className="text-xs text-slate-500">Avg query (15m): {health.db.avgQueryMs ?? 0} ms</p>
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">Memory</h2>
              <p className="mt-2 text-lg font-semibold">{health.memory.usagePercent}%</p>
              <p className="text-xs text-slate-500">Used: {Math.round(health.memory.used / 1024 / 1024)} MB</p>
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">CPU</h2>
              <p className="mt-2 text-lg font-semibold">{health.cpu.usagePercent}%</p>
              <p className="text-xs text-slate-500">Load 1m/5m/15m: {health.cpu.load1m.toFixed(2)} / {health.cpu.load5m.toFixed(2)} / {health.cpu.load15m.toFixed(2)}</p>
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">Uptime</h2>
              <p className="mt-2 text-lg font-semibold">{Math.floor((health.uptime.seconds || 0) / 3600)}h</p>
              <p className="text-xs text-slate-500">Since {new Date(health.uptime.since).toLocaleString()}</p>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-medium text-slate-900">API Health by Endpoint</h2>
              <div className="mt-3 max-h-80 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-slate-500"><tr><th className="py-2 pr-3">Endpoint</th><th className="py-2 pr-3">Hits</th><th className="py-2 pr-3">Avg response</th><th className="py-2 pr-3">Last seen</th></tr></thead>
                  <tbody>
                    {health.apiHealth.map((row) => (
                      <tr key={row.endpoint} className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-mono text-xs">{row.endpoint}</td>
                        <td className="py-2 pr-3">{row.hits}</td>
                        <td className="py-2 pr-3">{row.avgResponseMs} ms</td>
                        <td className="py-2 pr-3">{row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-medium text-slate-900">Webhook Audit (Paddle)</h2>
              <p className="text-xs text-slate-500">Processed: {health.webhookAudit.processed} · Failed: {health.webhookAudit.failed} · Total: {health.webhookAudit.total}</p>
              <div className="mt-3 max-h-80 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-slate-500"><tr><th className="py-2 pr-3">Timestamp</th><th className="py-2 pr-3">Event</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Payload</th></tr></thead>
                  <tbody>
                    {webhooks.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{new Date(row.timestamp).toLocaleString()}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{row.eventType}</td>
                        <td className="py-2 pr-3">{row.status}</td>
                        <td className="py-2 pr-3"><details><summary className="cursor-pointer text-xs text-indigo-700">View req/resp</summary><pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-100 p-2 text-xs">{JSON.stringify({ request: row.requestBody, response: row.responseBody }, null, 2)}</pre></details></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-medium text-slate-900">Job Queue Status</h2>
            <p className="text-xs text-slate-500">Pending: {health.jobQueue.counts.pending} · Processing: {health.jobQueue.counts.processing} · Failed: {health.jobQueue.counts.failed}</p>

            <div className="mt-3 grid gap-4 xl:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-slate-800">Average processing time by job type</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {health.jobQueue.avgProcessingTimeByType.map((row) => (
                    <li key={row.jobType} className="flex items-center justify-between rounded border border-slate-100 px-3 py-2">
                      <span className="font-mono text-xs">{row.jobType}</span>
                      <span>{row.avgProcessingMs} ms ({row.total} jobs)</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-800">Failed jobs</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {health.jobQueue.failedJobs.map((job) => (
                    <li key={job.id} className="rounded border border-slate-100 px-3 py-2">
                      <p className="font-mono text-xs">{job.transaction_id}</p>
                      <p className="text-xs text-slate-600">{job.last_error || 'No error message'}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-slate-500">Retries: {job.retry_count}</span>
                        <button onClick={() => void retryJob(job.id)} className="rounded border border-indigo-300 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50">Retry</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
