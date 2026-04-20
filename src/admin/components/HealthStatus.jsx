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

export default function HealthStatus({ health, alerts }) {
  if (!health) return null

  const status = health.systemStatus || 'green'

  return (
    <section className={`admin-health admin-health--${status}`}>
      <div className="admin-health__header">
        <h3 className="admin-section-title !mb-0">System health</h3>
        <span className={`admin-health__status admin-health__status--${status}`}>{status}</span>
      </div>

      <div className="admin-grid admin-grid--4 mt-4">
        <Stat label='DB connected' value={health.db?.connected ? 'Yes' : 'No'} />
        <Stat label='DB latency' value={`${health.db?.latencyMs || 0} ms`} />
        <Stat label='Memory usage' value={`${health.memory?.usagePercent || 0}%`} />
        <Stat label='CPU usage' value={`${health.cpu?.usagePercent || 0}%`} />
        <Stat label='Memory used' value={formatBytes(health.memory?.used)} />
        <Stat label='Uptime' value={`${health.uptime?.seconds || 0}s`} />
      </div>

      {alerts?.length > 0 && (
        <div className="mt-4 grid gap-2">
          {alerts.map((alert) => (
            <div
              key={alert.message}
              className={`admin-inline-alert px-3 py-2 text-sm ${alert.severity === 'critical' ? 'admin-inline-alert--error' : 'admin-inline-alert--warning'}`}
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
    <div className="admin-stat-card">
      <div className="admin-stat-card__label">{label}</div>
      <div className="admin-stat-card__value">{value}</div>
    </div>
  )
}
