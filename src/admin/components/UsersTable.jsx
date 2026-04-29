import { EmptyState, TableSkeleton } from './WidgetState'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const COLUMNS = [
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'subscription_status', label: 'Subscription' },
  { key: 'created_at', label: 'Created' },
]

export default function UsersTable({ users, loading, sortBy, sortDirection, onSort, onSelectUser, onToggleBlock }) {
  return (
    <div className="admin-table-surface overflow-hidden">
      <table className="admin-table text-left text-sm">
        <thead className="">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} className="px-4 py-3">
                <button className="inline-flex items-center gap-1 font-medium" onClick={() => onSort(column.key)}>
                  {column.label}
                  {sortBy === column.key ? <span>{sortDirection === 'asc' ? '↑' : '↓'}</span> : null}
                </button>
              </th>
            ))}
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        {loading ? <TableSkeleton columns={5} rows={5} /> : (
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="cursor-pointer  hover:bg-[var(--color-white-alpha-03)]" onClick={() => onSelectUser(user)}>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">{user.company || '—'}</td>
                <td className="px-4 py-3">{user.subscription_status || '—'}</td>
                <td className="px-4 py-3">{formatDate(user.created_at)}</td>
                <td className="px-4 py-3">
                  <button className="ui-btn ui-btn--primary text-xs" onClick={(event) => { event.stopPropagation(); onToggleBlock(user) }}>
                    {user.status === 'blocked' ? 'Unblock' : 'Block'}
                  </button>
                </td>
              </tr>
            ))}
            {!users.length ? <tr><td colSpan={5} className="p-4"><EmptyState title="No users found" description="Try a different search or status filter." /></td></tr> : null}
          </tbody>
        )}
      </table>
    </div>
  )
}
