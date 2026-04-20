export default function MetricCard({ label, value, helper = '', trend = null }) {
  const trendLabel = trend === null ? '—' : `${trend >= 0 ? '+' : ''}${Number(trend).toFixed(1)}%`

  return (
    <article className="ui-card p-4">
      <p className="admin-text-muted text-sm">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-sm ${trend === null ? 'admin-text-muted' : trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{trendLabel}</span>
        {helper ? <span className="admin-text-muted text-right text-xs">{helper}</span> : null}
      </div>
    </article>
  )
}
