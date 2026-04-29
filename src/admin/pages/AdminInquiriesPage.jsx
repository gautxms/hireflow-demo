import { useEffect } from 'react'
import StateAlert from '../components/StateAlert'
import AdminDataTable from '../components/table/AdminDataTable'
import useAdminInquiries from '../hooks/useAdminInquiries'

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function AdminInquiriesPage() {
  const {
    inquiries,
    loading,
    error,
    search,
    setSearch,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    page,
    setPage,
    totalPages,
    totalCount,
    pageSize,
    loadInquiries,
    markReviewed,
  } = useAdminInquiries()

  useEffect(() => {
    void loadInquiries()
  }, [loadInquiries])

  const columns = [
    { key: 'created_at', label: 'Created', sortable: false, render: (row) => formatDate(row.created_at) },
    { key: 'inquiry_type', label: 'Type', sortable: false, render: (row) => <span className="capitalize">{row.inquiry_type}</span> },
    { key: 'status', label: 'Status', sortable: false, render: (row) => <span className="capitalize">{row.status}</span> },
    { key: 'name', label: 'Name', sortable: false },
    { key: 'email', label: 'Email', sortable: false },
    { key: 'company', label: 'Company', sortable: false },
  ]

  return (
    <div className="admin-page">
      {error ? <StateAlert state={error} onRetry={() => void loadInquiries()} /> : null}

      <AdminDataTable
        title="Inquiries"
        subtitle={`${totalCount} inquiries · ${pageSize} per page`}
        columns={columns}
        rows={inquiries}
        loading={loading}
        rowKey={(row) => row.id}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, email, or company"
        filterControls={(
          <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
            <select className="ui-input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All types</option>
              <option value="contact">Contact</option>
              <option value="demo">Demo</option>
            </select>
            <select className="ui-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
            </select>
            <input type="date" className="ui-input" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            <input type="date" className="ui-input" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>
        )}
        pagination={{ page, totalPages, total: totalCount, pageSize }}
        onPageChange={setPage}
        renderDetails={(inquiry) => (
          <div className="space-y-3 text-sm">
            <p><strong>Type:</strong> <span className="capitalize">{inquiry.inquiry_type}</span></p>
            <p><strong>Status:</strong> <span className="capitalize">{inquiry.status}</span></p>
            <p><strong>Name:</strong> {inquiry.name}</p>
            <p><strong>Email:</strong> {inquiry.email}</p>
            <p><strong>Company:</strong> {inquiry.company || '—'}</p>
            <p><strong>Phone:</strong> {inquiry.phone || '—'}</p>
            <p><strong>Subject:</strong> {inquiry.subject || '—'}</p>
            <p><strong>Message:</strong> {inquiry.message}</p>
            {inquiry.metadata?.selectedDate || inquiry.metadata?.selectedTime ? (
              <p><strong>Requested slot:</strong> {inquiry.metadata?.selectedDate || '—'} {inquiry.metadata?.selectedTime ? `at ${inquiry.metadata.selectedTime}` : ''}</p>
            ) : null}
            <p><strong>Created:</strong> {formatDate(inquiry.created_at)}</p>
            <div className="flex gap-2 pt-2">
              <button type="button" className="ui-btn" onClick={() => void markReviewed(inquiry.id, inquiry.status === 'reviewed' ? 'new' : 'reviewed')}>
                {inquiry.status === 'reviewed' ? 'Mark as new' : 'Mark as reviewed'}
              </button>
            </div>
          </div>
        )}
      />
    </div>
  )
}
