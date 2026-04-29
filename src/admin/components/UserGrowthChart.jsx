export default function UserGrowthChart({ data = [] }) {
  const latest = data[data.length - 1] || { day: new Date().toISOString(), dau: 0, wau: 0, mau: 0 }
  const max = Math.max(1, ...data.flatMap((row) => [Number(row.dau || 0), Number(row.wau || 0), Number(row.mau || 0)]))
  const pct = (value) => Math.max(2, (Number(value || 0) / max) * 100)

  return (
    <section className="ui-card p-4">
      <h2 className="text-lg font-medium text-admin-strong">User Growth (DAU / WAU / MAU)</h2>
      <p className="mt-1 text-xs text-admin-muted">Latest day: {new Date(latest.day).toLocaleDateString()}</p>
      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-sm"><span>DAU</span><strong>{latest.dau || 0}</strong></div>
          <div className="h-4 rounded bg-admin-subtle"><div className="h-full rounded" style={{ width: `${pct(latest.dau)}%`, background: 'var(--admin-chart-series-dau)' }} /></div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-sm"><span>WAU</span><strong>{latest.wau || 0}</strong></div>
          <div className="h-4 rounded bg-admin-subtle"><div className="h-full rounded" style={{ width: `${pct(latest.wau)}%`, background: 'var(--admin-chart-series-wau)' }} /></div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-sm"><span>MAU</span><strong>{latest.mau || 0}</strong></div>
          <div className="h-4 rounded bg-admin-subtle"><div className="h-full rounded" style={{ width: `${pct(latest.mau)}%`, background: 'var(--admin-chart-series-mau)' }} /></div>
        </div>
      </div>
    </section>
  )
}
