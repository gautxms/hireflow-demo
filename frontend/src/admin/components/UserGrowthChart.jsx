export default function UserGrowthChart({ data = [] }) {
  const latest = data[data.length - 1] || { dau: 0, wau: 0, mau: 0 }

  const max = Math.max(1, ...data.flatMap((item) => [Number(item.dau || 0), Number(item.wau || 0), Number(item.mau || 0)]))

  const barStyle = (value, color) => ({
    width: `${Math.max(2, (Number(value || 0) / max) * 100)}%`,
    backgroundColor: color,
  })

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-medium text-slate-900">User Growth (DAU / WAU / MAU)</h2>
      <div className="mt-4 space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-600">DAU</span><strong>{latest.dau || 0}</strong></div>
          <div className="h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={barStyle(latest.dau, '#2563eb')} /></div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-600">WAU</span><strong>{latest.wau || 0}</strong></div>
          <div className="h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={barStyle(latest.wau, '#0d9488')} /></div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-600">MAU</span><strong>{latest.mau || 0}</strong></div>
          <div className="h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={barStyle(latest.mau, '#7c3aed')} /></div>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500">Values reflect trailing active users as of latest day in selected range.</p>
    </section>
  )
}
