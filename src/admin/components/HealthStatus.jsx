function formatBytes(value) {
  if (!value || Number.isNaN(Number(value))) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Number(value)
  let idx = 0
  while (size > 1024 && idx < units.length - 1) {
    size /= 1024
    idx += 1
  }
  return `${size.toFixed(1)} ${units[idx]}`
}

function statusColor(status) {
  if (status === 'red') return '#dc2626'
  if (status === 'yellow') return '#f59e0b'
  return '#16a34a'
}

export default function HealthStatus({ health, alerts }) {
  if (!health) return null

  const status = health.systemStatus || 'green'

  return (
    <section style={{ border: `2px solid ${statusColor(status)}`, borderRadius: 12, padding: '1rem', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>System health</h3>
        <span style={{ color: statusColor(status), fontWeight: 700, textTransform: 'uppercase' }}>{status}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
        <Stat label='DB connected' value={health.db?.connected ? 'Yes' : 'No'} />
        <Stat label='DB latency' value={`${health.db?.latencyMs || 0} ms`} />
        <Stat label='Memory usage' value={`${health.memory?.usagePercent || 0}%`} />
        <Stat label='CPU usage' value={`${health.cpu?.usagePercent || 0}%`} />
        <Stat label='Memory used' value={formatBytes(health.memory?.used)} />
        <Stat label='Uptime' value={`${health.uptime?.seconds || 0}s`} />
      </div>

      {alerts?.length > 0 && (
        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
          {alerts.map((alert) => (
            <div
              key={alert.message}
              style={{
                borderRadius: 8,
                padding: '0.6rem 0.75rem',
                border: '1px solid',
                borderColor: alert.severity === 'critical' ? '#fecaca' : '#fde68a',
                background: alert.severity === 'critical' ? '#fef2f2' : '#fffbeb',
                color: alert.severity === 'critical' ? '#991b1b' : '#92400e',
              }}
            >
              <strong>{alert.severity.toUpperCase()}:</strong> {alert.message}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.7rem' }}>
      <div style={{ color: '#6b7280', fontSize: '0.82rem' }}>{label}</div>
      <div style={{ fontWeight: 600, marginTop: '0.2rem' }}>{value}</div>
    </div>
  )
}
