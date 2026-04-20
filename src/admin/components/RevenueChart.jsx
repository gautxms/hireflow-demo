function money(value = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0))
}

export default function RevenueChart({ data = [] }) {
  const width = 760
  const height = 280
  const margin = { top: 24, right: 24, bottom: 36, left: 56 }
  const safeData = data.length ? data : [{ month: new Date().toISOString(), mrr: 0 }]
  const maxValue = Math.max(1, ...safeData.map((item) => Number(item.mrr || 0)))
  const stepX = safeData.length <= 1 ? 0 : (width - margin.left - margin.right) / (safeData.length - 1)
  const points = safeData.map((item, index) => {
    const x = margin.left + (index * stepX)
    const y = height - margin.bottom - ((Number(item.mrr || 0) / maxValue) * (height - margin.top - margin.bottom))
    return { ...item, x, y }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  return (
    <section className="ui-card p-4">
      <h2 className="text-lg font-medium text-slate-900">Revenue Trend (12 months)</h2>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-72 w-full">
        <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke="var(--admin-chart-axis)" />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} stroke="var(--admin-chart-axis)" />
        <path d={path} fill="none" stroke="var(--admin-chart-series-revenue)" strokeWidth="3" />
        {points.map((point) => (
          <g key={point.month}>
            <circle cx={point.x} cy={point.y} r="4" fill="var(--admin-chart-series-revenue)">
              <title>{`${new Date(point.month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}: ${money(point.mrr)}`}</title>
            </circle>
            <text x={point.x} y={height - 14} textAnchor="middle" fontSize="10" fill="var(--admin-chart-axis-label)">
              {new Date(point.month).toLocaleDateString(undefined, { month: 'short' })}
            </text>
          </g>
        ))}
      </svg>
    </section>
  )
}
