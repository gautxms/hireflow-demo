function dateLabel(value) {
  return value ? new Date(value).toLocaleDateString() : '—'
}

function SortButton({ label, field, currentSort, onSortChange }) {
  const isActive = currentSort.field === field
  const arrow = !isActive ? '↕' : currentSort.direction === 'asc' ? '↑' : '↓'

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium"
      onClick={() => {
        const nextDirection = isActive && currentSort.direction === 'asc' ? 'desc' : 'asc'
        onSortChange({ field, direction: nextDirection })
      }}
    >
      {label} <span className="text-slate-400">{arrow}</span>
    </button>
  )
}

export default function SubscriptionsTable({ subscriptions, loading, sort, onSortChange, onView, onRefund }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-3"><SortButton label="User email" field="email" currentSort={sort} onSortChange={onSortChange} /></th>
            <th className="px-4 py-3"><SortButton label="Plan" field="plan" currentSort={sort} onSortChange={onSortChange} /></th>
            <th className="px-4 py-3"><SortButton label="Status" field="status" currentSort={sort} onSortChange={onSortChange} /></th>
            <th className="px-4 py-3"><SortButton label="Renewal date" field="renewalDate" currentSort={sort} onSortChange={onSortChange} /></th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td className="px-4 py-3 text-slate-500" colSpan={5}>Loading subscriptions…</td></tr>
          ) : subscriptions.map((subscription) => (
            <tr key={subscription.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{subscription.email}</td>
              <td className="px-4 py-3 capitalize">{subscription.plan || '—'}</td>
              <td className="px-4 py-3 capitalize">{subscription.status || '—'}</td>
              <td className="px-4 py-3">{dateLabel(subscription.renewalDate)}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5" onClick={() => onView(subscription)}>
                    Details
                  </button>
                  <button type="button" className="rounded-md bg-rose-600 px-3 py-1.5 text-white" onClick={() => onRefund(subscription)}>
                    Refund
                  </button>
                </div>
              </td>
            </tr>
          ))}

          {!loading && !subscriptions.length ? (
            <tr><td className="px-4 py-3 text-slate-500" colSpan={5}>No subscriptions match these filters.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
