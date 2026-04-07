function formatPayload(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function WebhookAudit({ items, loading, error }) {
  return (
    <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Webhook audit trail</h3>

      {loading && <p style={{ color: '#6b7280' }}>Loading webhook events…</p>}
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {!loading && !error && !items.length && <p style={{ color: '#6b7280' }}>No webhook activity yet.</p>}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {items.map((event) => (
          <details key={event.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              {event.eventType} • {event.status} • {new Date(event.timestamp).toLocaleString()}
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap', margin: '0.75rem 0 0 0', fontSize: '0.8rem' }}>{formatPayload(event.requestBody)}</pre>
          </details>
        ))}
      </div>
    </section>
  )
}
