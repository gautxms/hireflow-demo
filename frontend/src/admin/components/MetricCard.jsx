export default function MetricCard({ label, value, helper = '', trend = null }) {
  const trendLabel = trend === null || trend === undefined
    ? '—'
    : `${trend >= 0 ? '+' : ''}${Number(trend).toFixed(1)}%`

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <div className="mt-2 flex items-center justify-between">
        <p className={`text-sm ${trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{trendLabel}</p>
        {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
      </div>
    </article>
  )
}
