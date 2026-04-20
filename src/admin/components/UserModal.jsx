import { useMemo, useState } from 'react'

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function UserModal({ user, onClose, onSave, onBlock, onUnblock, onResetPassword, onImpersonate, onDelete }) {
  const [company, setCompany] = useState(user?.company || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const actionsDisabled = !user

  const auditItems = useMemo(() => user?.auditTrail || [], [user])

  if (!user) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--color-bg-overlay-80)] p-4">
      <div className="ui-card max-h-[90vh] w-full max-w-3xl overflow-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">User details</h2>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
          <button className="ui-btn" onClick={onClose}>Close</button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Company</span>
            <input className="ui-input w-full" value={company} onChange={(event) => setCompany(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Phone</span>
            <input className="ui-input w-full" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
        </div>

        <div className="mt-2 text-sm text-slate-600">Created: {formatDate(user.created_at)} · Subscription: {user.subscription_status} · Status: {user.status}</div>

        {error ? <p className="admin-inline-alert admin-inline-alert--error mt-3">{error}</p> : null}
        {feedback ? <p className="admin-inline-alert admin-inline-alert--success mt-3">{feedback}</p> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="ui-btn ui-btn--primary"
            onClick={async () => {
              try {
                setError('')
                setFeedback('')
                await onSave({ company, phone })
                setFeedback('Profile updated successfully.')
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            Save profile
          </button>

          <button
            className="ui-btn"
            disabled={actionsDisabled}
            onClick={async () => {
              try {
                setError('')
                const payload = await onResetPassword()
                setFeedback(payload.message || 'Reset password email sent.')
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            Reset password
          </button>

          <button
            className="ui-btn"
            disabled={actionsDisabled}
            onClick={async () => {
              try {
                setError('')
                const payload = await onImpersonate()
                const token = payload.impersonationToken || payload.token || 'generated'
                setFeedback(`Impersonation token created (15 min): ${token}`)
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            Impersonate
          </button>

          <button
            className="ui-btn ui-btn--primary"
            onClick={() => {
              if (user.status === 'blocked') {
                void onUnblock()
                return
              }
              onBlock()
            }}
          >
            {user.status === 'blocked' ? 'Unblock user' : 'Block user'}
          </button>

          <button
            className="ui-btn"
            onClick={async () => {
              if (!window.confirm('Soft delete this user account?')) return
              try {
                setError('')
                await onDelete()
                setFeedback('User soft-deleted.')
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            Delete user
          </button>
        </div>

        <div className="admin-table-surface mt-6 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Audit trail</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {auditItems.map((entry) => (
              <li key={entry.id} className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2">
                <div className="font-medium text-slate-900">{entry.action}</div>
                <div className="text-xs text-slate-600">by {entry.actor || entry.admin_id || 'system'} at {formatDate(entry.created_at || entry.createdAt)}</div>
                {entry.details ? <pre className="mt-1 overflow-auto text-xs text-slate-500">{JSON.stringify(entry.details, null, 2)}</pre> : null}
              </li>
            ))}
            {!auditItems.length ? <li className="text-slate-500">No audit entries yet.</li> : null}
          </ul>
        </div>
      </div>
    </div>
  )
}
