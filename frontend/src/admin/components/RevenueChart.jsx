function compactMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0))
}

export default function RevenueChart({ data = [] }) {
  const width = 720
  const height = 260
  const margin = { top: 20, right: 20, bottom: 32, left: 48 }

  const safeData = data.length ? data : [{ month: new Date().toISOString().slice(0, 10), mrr: 0 }]
  const maxValue = Math.max(...safeData.map((item) => Number(item.mrr || 0)), 1)

  const stepX = safeData.length <= 1 ? 0 : (width - margin.left - margin.right) / (safeData.length - 1)

  const points = safeData.map((item, index) => {
    const x = margin.left + stepX * index
    const y = height - margin.bottom - ((Number(item.mrr || 0) / maxValue) * (height - margin.top - margin.bottom))
    return { x, y, label: item.month, value: Number(item.mrr || 0) }
  })

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-medium text-slate-900">Revenue Trend (MRR · last 12 months)</h2>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-64 w-full">
        <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke="#cbd5e1" />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} stroke="#cbd5e1" />
        <path d={path} fill="none" stroke="#4f46e5" strokeWidth="3" />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="3" fill="#4f46e5" />
          </g>
        ))}
      </svg>
      <div className="grid gap-1 text-xs text-slate-500 sm:grid-cols-3">
        {points.slice(-3).map((point) => (
          <p key={point.label}>{new Date(point.label).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}: {compactMoney(point.value)}</p>
        ))}
      </div>
    </section>
  )
}
