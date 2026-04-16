import { useEffect, useMemo, useState } from 'react'
import PaymentsList from '../components/PaymentsList'
import StateAlert from '../components/StateAlert'
import { EmptyState } from '../components/WidgetState'
import API_BASE from '../../config/api'
import { adminFetchJson, getMappedError } from '../utils/adminErrorState'
import AdminDataTable from '../components/table/AdminDataTable'
import useSharedTableState from '../hooks/useSharedTableState'

function money(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)
}

function moneyFromDollars(amount = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0)
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

const COLUMN_PRESETS = [
  { id: 'default', label: 'Default columns', columns: ['transactionId', 'email', 'status', 'amountCents', 'billedAt'] },
  { id: 'failed', label: 'Failed payment ops', columns: ['transactionId', 'email', 'status', 'amountCents', 'billedAt'] },
]

const FILTER_PRESETS = [{ id: 'failed_today', label: 'Failed uploads today' }]

export default function AdminPaymentsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [retryingId, setRetryingId] = useState('')
  const [data, setData] = useState({ transactions: [], failedPayments: [], revenueSummary: null, auditTrail: [] })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState({ field: 'billedAt', direction: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const { savedFilterChips, saveChip, removeChip, activePreset, setActivePreset } = useSharedTableState({ storageKey: 'admin-payments-table' })

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const payload = await adminFetchJson(`${API_BASE}/admin/payments`, 'Failed to load payment admin data')
      setData(payload)
    } catch (err) {
      setError(getMappedError(err, 'Payments data could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const retryFailedPayment = async (transactionId) => {
    try {
      setRetryingId(transactionId)
      const response = await fetch(`${API_BASE}/admin/payments/${transactionId}/retry`, { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Retry failed')
      await loadData()
    } finally {
      setRetryingId('')
    }
  }

  const filteredTransactions = useMemo(() => {
    const normalized = search.toLowerCase()
    const filtered = (data.transactions || []).filter((item) => {
      const text = `${item.transactionId || item.invoiceNumber || item.id} ${item.email || ''}`.toLowerCase()
      return (!normalized || text.includes(normalized)) && (status === 'all' || item.status === status)
    })
    const direction = sort.direction === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      const left = a[sort.field]
      const right = b[sort.field]
      if (sort.field === 'billedAt') return (new Date(left || 0).getTime() - new Date(right || 0).getTime()) * direction
      return String(left || '').localeCompare(String(right || '')) * direction
    })
    return filtered
  }, [data.transactions, search, sort.direction, sort.field, status])

  const pageCount = Math.max(1, Math.ceil(filteredTransactions.length / pageSize))
  const pagedTransactions = filteredTransactions.slice((page - 1) * pageSize, page * pageSize)

  const visibleColumnKeys = useMemo(() => COLUMN_PRESETS.find((preset) => preset.id === activePreset)?.columns || COLUMN_PRESETS[0].columns, [activePreset])
  const allColumns = useMemo(() => ([
    { key: 'transactionId', label: 'Transaction', sortable: true, render: (row) => row.transactionId || row.invoiceNumber || row.id },
    { key: 'email', label: 'Customer', sortable: true, render: (row) => row.email || '—' },
    { key: 'status', label: 'Status', sortable: true, render: (row) => <span className="capitalize">{row.status || '—'}</span> },
    { key: 'amountCents', label: 'Amount', sortable: true, render: (row) => money(row.amountCents) },
    { key: 'billedAt', label: 'Billed at', sortable: true, render: (row) => dateLabel(row.billedAt) },
  ]), [])
  const columns = allColumns.filter((column) => visibleColumnKeys.includes(column.key))

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin payments & revenue</h1>
      {error ? <StateAlert state={error} onRetry={() => void loadData()} /> : null}

      {data.revenueSummary ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">MRR: <strong>{moneyFromDollars(data.revenueSummary.mrr)}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">ARR: <strong>{moneyFromDollars(data.revenueSummary.arr)}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">Churn: <strong>{Number(data.revenueSummary.churnRate || 0).toFixed(2)}%</strong></div>
        </div>
      ) : null}

      <PaymentsList failedPayments={data.failedPayments} retryingId={retryingId} onRetry={retryFailedPayment} />

      <AdminDataTable
        title="Transactions"
        subtitle="Unified search, sort, pagination, export, and row details."
        columns={columns}
        rows={pagedTransactions}
        loading={loading}
        rowKey={(row) => row.id}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search transaction or customer"
        filterControls={(
          <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
        )}
        sort={sort}
        onSortChange={(field) => setSort((current) => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }))}
        pagination={{ page, totalPages: pageCount, total: filteredTransactions.length, pageSize }}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        filterPresets={FILTER_PRESETS}
        onApplyFilterPreset={(presetId) => {
          if (presetId !== 'failed_today') return
          setStatus('failed')
        }}
        savedFilterChips={savedFilterChips}
        onSaveFilterChip={(label) => saveChip(label, { search, status })}
        onApplySavedFilter={(chipId) => {
          const chip = savedFilterChips.find((item) => item.id === chipId)
          if (!chip) return
          setSearch(chip.filters.search || '')
          setStatus(chip.filters.status || 'all')
        }}
        onRemoveSavedFilter={removeChip}
        columnPresets={COLUMN_PRESETS}
        activePreset={activePreset}
        onPresetChange={setActivePreset}
        renderDetails={(item) => (
          <div className="space-y-2 text-sm">
            <p><strong>Transaction:</strong> {item.transactionId || item.invoiceNumber || item.id}</p>
            <p><strong>Customer:</strong> {item.email || '—'}</p>
            <p><strong>Status:</strong> {item.status || '—'}</p>
            <p><strong>Amount:</strong> {money(item.amountCents)}</p>
            <p><strong>Billed at:</strong> {dateLabel(item.billedAt)}</p>
          </div>
        )}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-medium text-slate-900">Refund history</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(data.auditTrail || []).map((item) => <li key={item.id} className="rounded border border-slate-100 p-2">{dateLabel(item.createdAt)} · tx: {item.transactionId} · {item.reason} · {money(item.amountCents)} · admin: {item.adminId}</li>)}
          {!data.auditTrail?.length ? <li><EmptyState title="No refund events" description="No refunds have been recorded yet." /></li> : null}
        </ul>
      </section>
    </div>
  )
}
