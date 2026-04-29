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
    <section className="ui-card ui-card--card-spacing admin-feedback">
      <h2 className="admin-section-title">Was this page useful?</h2>
      <p className="admin-page__subtitle">Feedback is tied to <code>{routeContext}</code> for weekly UX triage.</p>
      <form className="admin-feedback__form" onSubmit={onSubmit}>
        <div className="admin-feedback__choice-group" role="group" aria-label="Feedback choice">
          <button type="button" className={`ui-btn ${choice === true ? 'ui-btn--primary' : ''}`} onClick={() => setChoice(true)}>Yes</button>
          <button type="button" className={`ui-btn ${choice === false ? 'ui-btn--primary' : ''}`} onClick={() => setChoice(false)}>No</button>
        </div>
        <textarea
          className="ui-input admin-feedback__comment"
          rows={3}
          placeholder="Optional: what was confusing or missing?"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <div className="admin-feedback__submit-row">
          <button className="ui-btn ui-btn--primary" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send feedback'}</button>
        </div>
      </form>
      {status ? <p className="admin-inline-alert admin-inline-alert--info">{status}</p> : null}
      {error ? <p className="admin-inline-alert admin-inline-alert--error">{error}</p> : null}
    </section>
  )
}
