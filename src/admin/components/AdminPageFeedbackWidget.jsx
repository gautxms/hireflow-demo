import { useState } from 'react'
import useAdminUxTracking from '../hooks/useAdminUxTracking'

export default function AdminPageFeedbackWidget({ routeContext }) {
  const { submitPageFeedback } = useAdminUxTracking()
  const [choice, setChoice] = useState(null)
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event) => {
    event.preventDefault()

    if (choice === null) {
      setError('Please select yes or no before submitting feedback.')
      return
    }

    setSubmitting(true)
    setError('')
    setStatus('Submitting feedback…')

    try {
      await submitPageFeedback({
        isUseful: choice,
        comment,
        route: routeContext,
      })
      setStatus('Thanks — your feedback was captured.')
      setComment('')
      setChoice(null)
    } catch (submitError) {
      setStatus('')
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="ui-card p-4" style={{ marginTop: 20 }}>
      <h2 className="text-base font-semibold text-slate-900">Was this page useful?</h2>
      <p className="mt-1 text-sm text-slate-600">Feedback is tied to <code>{routeContext}</code> for weekly UX triage.</p>
      <form className="mt-3 space-y-3" onSubmit={onSubmit}>
        <div className="flex gap-2">
          <button type="button" className={`ui-btn ${choice === true ? 'bg-slate-900 text-white' : ''}`} onClick={() => setChoice(true)}>Yes</button>
          <button type="button" className={`ui-btn ${choice === false ? 'bg-slate-900 text-white' : ''}`} onClick={() => setChoice(false)}>No</button>
        </div>
        <textarea
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          placeholder="Optional: what was confusing or missing?"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <button className="ui-btn" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send feedback'}</button>
      </form>
      {status ? <p className="mt-2 text-sm text-sky-700">{status}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </section>
  )
}
