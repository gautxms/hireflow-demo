export default function StateAlert({ state, onRetry }) {
  if (!state) return null

  return (
    <div className="ui-toast text-sm">
      <p className="ui-toast__title">{state.title}</p>
      <p className="mt-1"><strong>Cause:</strong> {state.cause}</p>
      <p className="mt-1"><strong>Impact:</strong> {state.impact}</p>
      <p className="mt-1"><strong>Next action:</strong> {state.nextAction}</p>
      {state.canRetry && onRetry ? (
        <button type="button" onClick={onRetry} className="ui-btn ui-btn--primary mt-3">
          Retry
        </button>
      ) : null}
    </div>
  )
}
