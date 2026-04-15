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
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem', background: '#fff' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <svg viewBox='0 0 100 100' preserveAspectRatio='none' style={{ width: '100%', height: 140, background: '#f9fafb', borderRadius: 8 }}>
        <polyline fill='none' stroke={color} strokeWidth='2' points={points} />
      </svg>
      <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>Latest: {latest ? `${accessor(latest)}%` : '—'}</div>
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
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem', display: 'grid', gap: '1rem' }}>
      <h1 style={{ marginBottom: 0 }}>Admin system health</h1>
      <p style={{ marginTop: 0, color: '#6b7280' }}>Real-time service status refreshes every 10 seconds.</p>

      {criticalAlert && (
        <div style={{ background: '#7f1d1d', color: '#fff', padding: '0.7rem 0.9rem', borderRadius: 10, fontWeight: 700 }}>
          Critical alert active. Immediate attention required.
        </div>
      )}

      {loading && <p style={{ color: '#6b7280' }}>Loading health data…</p>}
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

      <HealthStatus health={health} alerts={health?.alerts || []} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        <MetricChart title='Memory usage trend' color='#2563eb' data={history} accessor={(point) => point.memoryPercent} />
        <MetricChart title='CPU usage trend' color='#9333ea' data={history} accessor={(point) => point.cpuPercent} />
      </div>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem', background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>API endpoint health</h3>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {(health?.apiHealth || []).map((endpoint) => (
            <div key={endpoint.endpoint} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1rem', borderBottom: '1px solid #f3f4f6', paddingBottom: '0.4rem' }}>
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
