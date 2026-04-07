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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
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
        <tbody>
          {loading ? (
            <tr><td className="px-4 py-4 text-slate-500" colSpan={5}>Loading users…</td></tr>
          ) : users.map((user) => (
            <tr key={user.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onSelectUser(user)}>
              <td className="px-4 py-3">{user.email}</td>
              <td className="px-4 py-3">{user.company || '—'}</td>
              <td className="px-4 py-3">{user.subscription_status || '—'}</td>
              <td className="px-4 py-3">{formatDate(user.created_at)}</td>
              <td className="px-4 py-3">
                <button
                  className={`rounded-md px-3 py-1.5 text-xs font-medium text-white ${user.status === 'blocked' ? 'bg-emerald-600' : 'bg-rose-600'}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleBlock(user)
                  }}
                >
                  {user.status === 'blocked' ? 'Unblock' : 'Block'}
                </button>
              </td>
            </tr>
          ))}
          {!loading && !users.length ? (
            <tr><td className="px-4 py-4 text-slate-500" colSpan={5}>No users found.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
