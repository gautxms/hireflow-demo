import { useEffect, useState } from 'react'

export default function BlockUserModal({ isOpen, user, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setReason('')
      setSubmitting(false)
      setError('')
    }
  }, [isOpen])

  if (!isOpen || !user) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Block user</h2>
        <p className="mt-1 text-sm text-slate-600">Add a reason for blocking {user.email}. This will be written to the audit trail.</p>

        <textarea
          className="mt-4 w-full ui-input"
          rows={4}
          placeholder="Reason for block"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button className="ui-btn" onClick={onClose}>Cancel</button>
          <button
            className="rounded-md bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={submitting || !reason.trim()}
            onClick={async () => {
              try {
                setSubmitting(true)
                setError('')
                await onConfirm(reason.trim())
              } catch (err) {
                setError(err.message)
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {submitting ? 'Blocking…' : 'Confirm block'}
          </button>
        </div>
      </div>
    </div>
  )
}
