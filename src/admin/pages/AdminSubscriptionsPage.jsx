import { useMemo, useState } from 'react'
import RefundModal from '../components/RefundModal'
import useAdminSubscriptions from '../hooks/useAdminSubscriptions'
import StateAlert from '../components/StateAlert'
import AdminDataTable from '../components/table/AdminDataTable'
import useSharedTableState from '../hooks/useSharedTableState'

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function formatCurrency(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

const COLUMN_PRESETS = [
  { id: 'default', label: 'Default columns', columns: ['email', 'plan', 'status', 'renewalDate', 'amountCents'] },
  { id: 'collections', label: 'Collections view', columns: ['email', 'status', 'renewalDate', 'nextBillingDate', 'amountCents'] },
]

const FILTER_PRESETS = [
  { id: 'past_due_users', label: 'Past due users' },
]

export default function AdminSubscriptionsPage() {
  const [isRefundOpen, setIsRefundOpen] = useState(false)
  const [refundTarget, setRefundTarget] = useState(null)
  const {
    filters,
    setFilters,
    sort,
    setSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    loading,
    detailsLoading,
    error,
    subscriptions,
    totalSubscriptions,
    selectedId,
    selectedDetails,
    refreshSubscriptions,
    loadDetails,
  } = useAdminSubscriptions()

  const {
    savedFilterChips,
    saveChip,
    removeChip,
    activePreset,
    setActivePreset,
  } = useSharedTableState({ storageKey: 'admin-subscriptions-table' })

  const adminId = useMemo(() => localStorage.getItem('admin_id') || 'founder_admin', [])

  const visibleColumnKeys = useMemo(() => COLUMN_PRESETS.find((preset) => preset.id === activePreset)?.columns || COLUMN_PRESETS[0].columns, [activePreset])
  const allColumns = useMemo(() => ([
    { key: 'email', label: 'User email', sortable: true },
    { key: 'plan', label: 'Plan', sortable: true, render: (row) => <span className="capitalize">{row.plan}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (row) => <span className="capitalize">{row.status}</span> },
    { key: 'renewalDate', label: 'Renewal date', sortable: true, render: (row) => dateLabel(row.renewalDate) },
    { key: 'nextBillingDate', label: 'Next billing', sortable: true, render: (row) => dateLabel(row.nextBillingDate) },
    { key: 'amountCents', label: 'Amount', sortable: true, render: (row) => formatCurrency(row.amountCents) },
  ]), [])
  const columns = allColumns.filter((column) => visibleColumnKeys.includes(column.key))

  return (
    <div className="admin-page">

      {error ? <StateAlert state={error} onRetry={() => void refreshSubscriptions()} /> : null}

      <AdminDataTable
        title="Subscriptions"
        subtitle={`${totalSubscriptions} matching subscriptions`}
        columns={columns}
        rows={subscriptions}
        loading={loading}
        rowKey={(row) => row.id}
        filterControls={(
          <>
            <select className="ui-input" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="cancelled">Cancelled</option>
              <option value="overdue">Overdue</option>
            </select>
            <select className="ui-input" value={filters.plan} onChange={(event) => setFilters((prev) => ({ ...prev, plan: event.target.value }))}>
              <option value="all">All plans</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </>
        )}
        sort={sort}
        onSortChange={(field) => setSort((current) => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }))}
        pagination={{ page, totalPages: pageCount, total: totalSubscriptions, pageSize }}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onRowClick={(row) => void loadDetails(row.id)}
        filterPresets={FILTER_PRESETS}
        onApplyFilterPreset={(presetId) => {
          if (presetId !== 'past_due_users') return
          setFilters((prev) => ({ ...prev, status: 'overdue' }))
        }}
        savedFilterChips={savedFilterChips}
        onSaveFilterChip={(label) => saveChip(label, filters)}
        onApplySavedFilter={(chipId) => {
          const chip = savedFilterChips.find((item) => item.id === chipId)
          if (!chip) return
          setFilters((prev) => ({ ...prev, ...chip.filters }))
        }}
        onRemoveSavedFilter={removeChip}
        columnPresets={COLUMN_PRESETS}
        activePreset={activePreset}
        onPresetChange={setActivePreset}
        renderDetails={(subscription) => (
          <div className="space-y-3 text-sm">
            {detailsLoading && selectedId === subscription.id ? <p className="text-slate-500">Loading details…</p> : null}
            <p><strong>Email:</strong> {subscription.email}</p>
            <p><strong>Status:</strong> <span className="capitalize">{subscription.status}</span></p>
            <p><strong>Plan:</strong> <span className="capitalize">{subscription.plan}</span></p>
            <p><strong>Renewal:</strong> {dateLabel(subscription.renewalDate)}</p>
            <p><strong>Next billing:</strong> {dateLabel(subscription.nextBillingDate)}</p>
            <p><strong>Amount:</strong> {formatCurrency(subscription.amountCents)}</p>
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                setRefundTarget(subscription)
                setIsRefundOpen(true)
                if (selectedId !== subscription.id) {
                  void loadDetails(subscription.id)
                }
              }}
            >
              Open refund flow
            </button>
          </div>
        )}
      />

      <RefundModal
        isOpen={isRefundOpen}
        subscription={refundTarget}
        details={selectedId === refundTarget?.id ? selectedDetails : null}
        adminId={adminId}
        onClose={() => setIsRefundOpen(false)}
        onSuccess={(payload) => {
          const message = payload?.message || 'Refund issued successfully.'
          window.alert(`${message} Customer notification email sent by payment provider.`)
          void refreshSubscriptions()
          if (refundTarget) {
            void loadDetails(refundTarget.id)
          }
        }}
      />
    </div>
  )
}
