import StatePattern from '../../components/state/StatePattern'

export default function StateAlert({ state, onRetry }) {
  if (!state) return null

  const summary = [
    state.cause ? `Cause: ${state.cause}` : null,
    state.impact ? `Impact: ${state.impact}` : null,
    state.nextAction ? `Next action: ${state.nextAction}` : null,
  ].filter(Boolean).join(' ')

  return (
    <StatePattern
      kind="error"
      compact
      title={state.title || 'Something went wrong'}
      description={summary}
      action={state.canRetry && onRetry ? (
        <button type="button" onClick={onRetry} className="ui-btn ui-btn--primary">
          Retry
        </button>
      ) : null}
    />
  )
}
