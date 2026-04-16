function toPct(value, base) {
  if (!base) return '0.0%'
  return `${((Number(value || 0) / base) * 100).toFixed(1)}%`
}

export default function ConversionFunnel({ signups = 0, verified = 0, paid = 0 }) {
  const steps = [
    { label: 'Signup', value: signups, color: 'bg-indigo-500' },
    { label: 'Verified', value: verified, color: 'bg-cyan-500' },
    { label: 'Paid', value: paid, color: 'bg-emerald-500' },
  ]

  return (
    <section className="ui-card p-4">
      <h2 className="text-lg font-medium text-slate-900">Conversion Funnel</h2>
      <div className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const ratio = toPct(step.value, signups)
          const width = Math.max(20, Math.round((Number(step.value || 0) / Math.max(1, signups)) * 100))

          return (
            <div key={step.label}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>{step.label}</span>
                <span className="font-medium">{step.value} <span className="text-slate-500">({ratio})</span></span>
              </div>
              <div className="h-9 rounded-md bg-slate-100 p-1">
                <div className={`h-full rounded-md ${step.color} transition-all`} style={{ width: `${width}%` }} />
              </div>
              {index < steps.length - 1 ? <p className="mt-1 text-xs text-slate-500">Step conversion: {toPct(steps[index + 1].value, step.value)}</p> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
