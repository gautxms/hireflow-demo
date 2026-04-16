import { useEffect, useMemo, useState } from 'react'
import BlockUserModal from '../components/BlockUserModal'
import UserModal from '../components/UserModal'
import StateAlert from '../components/StateAlert'
import AdminDataTable from '../components/table/AdminDataTable'
import useAdminUsers from '../hooks/useAdminUsers'
import useSharedTableState from '../hooks/useSharedTableState'
import { getMappedError } from '../utils/adminErrorState'

const COLUMN_PRESETS = [
  { id: 'default', label: 'Default columns', columns: ['email', 'company', 'status', 'subscription_status', 'created_at'] },
  { id: 'security', label: 'Security ops', columns: ['email', 'status', 'subscription_status', 'created_at'] },
]

const FILTER_PRESETS = [
  { id: 'past_due_users', label: 'Past due users', patch: { statusFilter: 'inactive', search: '' } },
]

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

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
  const [actionFeedback, setActionFeedback] = useState('')

  const {
    savedFilterChips,
    saveChip,
    removeChip,
    activePreset,
    setActivePreset,
  } = useSharedTableState({ storageKey: 'admin-users-table' })

  const selectedUser = selectedUserId ? getUserById(selectedUserId) : null

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const visibleColumnKeys = useMemo(() => COLUMN_PRESETS.find((preset) => preset.id === activePreset)?.columns || COLUMN_PRESETS[0].columns, [activePreset])
  const allColumns = useMemo(() => ([
    { key: 'email', label: 'Email', sortable: true },
    { key: 'company', label: 'Company', sortable: true },
    { key: 'status', label: 'Status', sortable: false, render: (row) => <span className="capitalize">{row.status}</span> },
    { key: 'subscription_status', label: 'Subscription', sortable: true, render: (row) => <span className="capitalize">{row.subscription_status}</span> },
    { key: 'created_at', label: 'Created', sortable: true, render: (row) => formatDate(row.created_at) },
  ]), [])
  const columns = allColumns.filter((column) => visibleColumnKeys.includes(column.key))

  return (
    <div className="admin-page">
      <h1 className="admin-page__title">Admin Users Management</h1>

      {error ? <StateAlert state={error} onRetry={() => void loadUsers()} /> : null}
      {actionFeedback ? <p className="text-sm text-emerald-700">{actionFeedback}</p> : null}

      <AdminDataTable
        title="Users"
        subtitle={`${totalCount} users · ${pageSize} per page`}
        columns={columns}
        rows={users}
        loading={loading}
        rowKey={(row) => row.id}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by email or company"
        filterControls={(
          <select className="ui-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="blocked">Blocked</option>
          </select>
        )}
        sort={{ field: sortBy, direction: sortDirection }}
        onSortChange={setSort}
        pagination={{ page, totalPages, total: totalCount, pageSize }}
        onPageChange={setPage}
        filterPresets={FILTER_PRESETS}
        onApplyFilterPreset={(presetId) => {
          const preset = FILTER_PRESETS.find((item) => item.id === presetId)
          if (!preset) return
          if (preset.patch.search !== undefined) setSearch(preset.patch.search)
          if (preset.patch.statusFilter !== undefined) setStatusFilter(preset.patch.statusFilter)
        }}
        savedFilterChips={savedFilterChips}
        onSaveFilterChip={(label) => saveChip(label, { search, statusFilter })}
        onApplySavedFilter={(chipId) => {
          const chip = savedFilterChips.find((item) => item.id === chipId)
          if (!chip) return
          setSearch(chip.filters.search || '')
          setStatusFilter(chip.filters.statusFilter || 'all')
        }}
        onRemoveSavedFilter={removeChip}
        columnPresets={COLUMN_PRESETS}
        activePreset={activePreset}
        onPresetChange={setActivePreset}
        renderDetails={(user) => (
          <div className="space-y-3 text-sm">
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Company:</strong> {user.company || '—'}</p>
            <p><strong>Status:</strong> <span className="capitalize">{user.status}</span></p>
            <p><strong>Joined:</strong> {formatDate(user.created_at)}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" className="ui-btn" onClick={() => setSelectedUserId(user.id)}>Open full editor</button>
              <button type="button" className="ui-btn" onClick={() => {
                if (user.status === 'blocked') {
                  void unblockUser(user.id)
                    .then(() => setActionFeedback(`Unblocked ${user.email}`))
                    .catch((err) => setActionFeedback(getMappedError(err, 'Unable to update user access.').title))
                  return
                }
                setBlockTarget(user)
              }}>{user.status === 'blocked' ? 'Unblock' : 'Block user'}</button>
            </div>
          </div>
        )}
      />

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
          setActionFeedback(`Blocked ${blockTarget.email || 'user'}`)
          setBlockTarget(null)
        }}
      />
    </div>
  )
}
