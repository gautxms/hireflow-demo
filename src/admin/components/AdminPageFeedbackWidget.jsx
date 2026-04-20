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
    <section className="ui-card mt-5 p-4" >
      <h2 className="text-base font-semibold text-admin-strong">Was this page useful?</h2>
      <p className="mt-1 text-sm text-admin-body">Feedback is tied to <code>{routeContext}</code> for weekly UX triage.</p>
      <form className="mt-3 space-y-3" onSubmit={onSubmit}>
        <div className="flex gap-2">
          <button type="button" className={`ui-btn ${choice === true ? 'ui-btn--primary' : ''}`} onClick={() => setChoice(true)}>Yes</button>
          <button type="button" className={`ui-btn ${choice === false ? 'ui-btn--primary' : ''}`} onClick={() => setChoice(false)}>No</button>
        </div>
        <textarea
          className="ui-input w-full text-sm"
          rows={3}
          placeholder="Optional: what was confusing or missing?"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <button className="ui-btn" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send feedback'}</button>
      </form>
      {status ? <p className="admin-inline-alert admin-inline-alert--info mt-2">{status}</p> : null}
      {error ? <p className="admin-inline-alert admin-inline-alert--error mt-2">{error}</p> : null}
    </section>
  )
}
