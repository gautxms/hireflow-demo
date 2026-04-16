import { useEffect, useMemo, useState } from 'react'
import HealthStatus from '../components/HealthStatus'
import API_BASE from '../../config/api'

function MetricChart({ data, color, title, accessor }) {
  const points = useMemo(() => {
    if (!data.length) return ''
    const max = Math.max(...data.map(accessor), 1)
    return data
      .map((item, index) => {
        const x = (index / Math.max(data.length - 1, 1)) * 100
        const y = 100 - (accessor(item) / max) * 100
        return `${x},${y}`
      })
      .join(' ')
  }, [accessor, data])

  const latest = data[data.length - 1]

  return (
    <section className="ui-card p-4">
      <h3 className="admin-section-title">{title}</h3>
      <svg viewBox='0 0 100 100' preserveAspectRatio='none' className="h-[140px] w-full rounded-md bg-slate-50">
        <polyline fill='none' stroke={color} strokeWidth='2' points={points} />
      </svg>
      <div className="admin-note mt-2">Latest: {latest ? `${accessor(latest)}%` : '—'}</div>
    </section>
  )
}

export default function AdminHealthPage() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [history, setHistory] = useState([])

  useEffect(() => {
    let isMounted = true

    const fetchHealth = async () => {
      try {
        const response = await fetch(`${API_BASE}/admin/health`, { credentials: 'include' })
        if (!response.ok) {
          throw new Error('Failed to load health status')
        }

        const payload = await response.json()
        if (!isMounted) return

        setHealth(payload)
        setHistory((current) => {
          const next = [...current, {
            timestamp: payload.generatedAt,
            memoryPercent: Number(payload.memory?.usagePercent || 0),
            cpuPercent: Number(payload.cpu?.usagePercent || 0),
          }]
          return next.slice(-30)
        })
        setError('')
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError.message || 'Unable to fetch health metrics')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchHealth()
    const interval = window.setInterval(fetchHealth, 10000)

    return () => {
      isMounted = false
      window.clearInterval(interval)
    }
  }, [])

  const criticalAlert = health?.alerts?.some((alert) => alert.severity === 'critical')

  return (
    <main className="admin-page">
      <h1 className="admin-page__title">Admin system health</h1>
      <p className="admin-page__subtitle">Real-time service status refreshes every 10 seconds.</p>

      {criticalAlert && (
        <div className="admin-alert admin-alert--critical">
          Critical alert active. Immediate attention required.
        </div>
      )}

      {loading && <p className="admin-note">Loading health data…</p>}
      {error && <p className="text-sm font-medium text-rose-700">{error}</p>}

      <HealthStatus health={health} alerts={health?.alerts || []} />

      <div className="admin-grid admin-grid--2">
        <MetricChart title='Memory usage trend' color='#2563eb' data={history} accessor={(point) => point.memoryPercent} />
        <MetricChart title='CPU usage trend' color='#9333ea' data={history} accessor={(point) => point.cpuPercent} />
      </div>

      <section className="ui-card p-4">
        <h3 className="admin-section-title">API endpoint health</h3>
        <div className="grid gap-2">
          {(health?.apiHealth || []).map((endpoint) => (
            <div key={endpoint.endpoint} className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-slate-100 pb-2 text-sm">
              <span>{endpoint.endpoint}</span>
              <span>{endpoint.hits} hits</span>
              <span>{endpoint.avgResponseMs} ms avg</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
