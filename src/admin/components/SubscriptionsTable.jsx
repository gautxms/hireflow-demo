import { EmptyState, TableSkeleton } from './WidgetState'
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
      {label} <span className="text-[var(--admin-text-muted)]">{arrow}</span>
    </button>
  )
}

export default function SubscriptionsTable({ subscriptions, loading, sort, onSortChange, onView, onRefund }) {
  return (
    <div className="admin-table-surface overflow-hidden">
      <table className="admin-table text-left text-sm">
        <thead className="">
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
            <TableSkeleton columns={5} rows={5} />
          ) : subscriptions.map((subscription) => (
            <tr key={subscription.id} className="">
              <td className="px-4 py-3">{subscription.email}</td>
              <td className="px-4 py-3 capitalize">{subscription.plan || '—'}</td>
              <td className="px-4 py-3 capitalize">{subscription.status || '—'}</td>
              <td className="px-4 py-3">{dateLabel(subscription.renewalDate)}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <button type="button" className="ui-btn ui-btn--ghost" onClick={() => onView(subscription)}>
                    Details
                  </button>
                  <button type="button" className="ui-btn ui-btn--primary" onClick={() => onRefund(subscription)}>
                    Refund
                  </button>
                </div>
              </td>
            </tr>
          ))}

          {!loading && !subscriptions.length ? (
            <tr><td className="p-4" colSpan={5}><EmptyState title="No subscriptions found" description="No subscriptions match these filters." /></td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
