import StateAlert from './StateAlert'
import { EmptyState } from './WidgetState'

function formatPayload(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function WebhookAudit({ items, loading, error, onRetry }) {
  return (
    <section className="ui-card p-4">
      <h3 className="admin-section-title">Webhook audit trail</h3>
      {loading ? <p className="admin-note">Loading webhook events…</p> : null}
      {error ? <StateAlert state={error} onRetry={onRetry} /> : null}
      {!loading && !error && !items.length ? <EmptyState title="No webhook activity yet" description="Events will appear here once integrations start sending webhooks." /> : null}

      <div className="admin-webhook-list">
        {items.map((event) => (
          <details key={event.id} className="admin-webhook-item">
            <summary className="admin-webhook-summary">
              {event.eventType} • {event.status} • {new Date(event.timestamp).toLocaleString()}
            </summary>
            <pre className="admin-pre">{formatPayload(event.requestBody)}</pre>
          </details>
        ))}
      </div>
    </section>
  )
}
