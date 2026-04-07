import { useEffect, useState } from 'react'
import BlockUserModal from '../components/BlockUserModal'
import UserModal from '../components/UserModal'
import UsersTable from '../components/UsersTable'
import useAdminUsers from '../hooks/useAdminUsers'

export default function AdminUsersPage() {
  const {
    users,
    loading,
    error,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    sortBy,
    sortDirection,
    setSort,
    page,
    setPage,
    totalPages,
    totalCount,
    pageSize,
    loadUsers,
    updateProfile,
    blockUser,
    unblockUser,
    resetPassword,
    impersonateUser,
    deleteUser,
    getUserById,
  } = useAdminUsers()

  const [selectedUserId, setSelectedUserId] = useState(null)
  const [blockTarget, setBlockTarget] = useState(null)
  const selectedUser = selectedUserId ? getUserById(selectedUserId) : null

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Admin Users Management</h1>
        <p className="text-sm text-slate-600">Search, filter, and manage user access.</p>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3">
        <input
          type="text"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search by email or company"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="blocked">Blocked</option>
        </select>
        <div className="text-sm text-slate-600">{totalCount} users · {pageSize} per page</div>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <UsersTable
        users={users}
        loading={loading}
        sortBy={sortBy}
        sortDirection={sortDirection}
        onSort={setSort}
        onSelectUser={(user) => setSelectedUserId(user.id)}
        onToggleBlock={(user) => {
          if (user.status === 'blocked') {
            void unblockUser(user.id)
            return
          }
          setBlockTarget(user)
        }}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Page {page} of {totalPages}</p>
        <div className="flex gap-2">
          <button className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50" disabled={page <= 1} onClick={() => setPage(Math.max(page - 1, 1))}>Previous</button>
          <button className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage(Math.min(page + 1, totalPages))}>Next</button>
        </div>
      </div>

      <UserModal
        key={selectedUser?.id || 'no-user'}
        user={selectedUser}
        onClose={() => setSelectedUserId(null)}
        onSave={(updates) => updateProfile(selectedUser.id, updates)}
        onBlock={() => setBlockTarget(selectedUser)}
        onUnblock={() => unblockUser(selectedUser.id)}
        onResetPassword={() => resetPassword(selectedUser.id)}
        onImpersonate={() => impersonateUser(selectedUser.id)}
        onDelete={() => deleteUser(selectedUser.id)}
      />

      <BlockUserModal
        isOpen={Boolean(blockTarget)}
        user={blockTarget}
        onClose={() => setBlockTarget(null)}
        onConfirm={async (reason) => {
          await blockUser(blockTarget.id, reason)
          setBlockTarget(null)
        }}
      />
    </div>
  )
}
