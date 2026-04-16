export default function MetricCard({ label, value, helper = '', trend = null }) {
  const trendLabel = trend === null ? '—' : `${trend >= 0 ? '+' : ''}${Number(trend).toFixed(1)}%`

  return (
    <article className="ui-card p-4">
      <p className="text-sm text-slate-700">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-sm ${trend === null ? 'text-slate-600' : trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{trendLabel}</span>
        {helper ? <span className="text-right text-xs text-slate-700">{helper}</span> : null}
      </div>
    </article>
  )
}
