export default function StateAlert({ state, onRetry }) {
  if (!state) return null

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
      <p className="font-semibold">{state.title}</p>
      <p className="mt-1"><strong>Cause:</strong> {state.cause}</p>
      <p className="mt-1"><strong>Impact:</strong> {state.impact}</p>
      <p className="mt-1"><strong>Next action:</strong> {state.nextAction}</p>
      {state.canRetry && onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600">
          Retry
        </button>
      ) : null}
    </div>
  )
}
