const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export default function SubscriptionCard({ user, token, onRefresh }) {
  const getStatusColor = (status) => {
    const colors = {
      active: '#22c55e',
      trialing: '#3b82f6',
      cancelled: '#ef4444',
      past_due: '#f59e0b',
    }

    return colors[status] || '#9ca3af'
  }

  const handleCancelSubscription = async () => {
    if (!window.confirm('Cancel subscription? You\'ll lose access after the current period.')) return

    try {
      const response = await fetch(`${API_BASE_URL}/api/billing/cancel-subscription`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to cancel subscription')
      }

      onRefresh?.()
    } catch {
      console.error('Failed to cancel subscription')
    }
  }

  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
      }}
    >
      <h2 style={{ marginBottom: '15px', fontSize: '18px', fontWeight: '600' }}>Subscription</h2>

      <div style={{ marginBottom: '15px' }}>
        <strong>Status:</strong>
        <span
          style={{
            display: 'inline-block',
            marginLeft: '10px',
            padding: '4px 12px',
            background: getStatusColor(user?.subscription_status),
            color: 'white',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: '600',
            textTransform: 'uppercase',
          }}
        >
          {user?.subscription_status || 'inactive'}
        </span>
      </div>

      <p><strong>Plan:</strong> {user?.subscription_plan || 'None'}</p>
      <p><strong>Started:</strong> {user?.subscription_started_at ? new Date(user.subscription_started_at).toLocaleDateString() : 'N/A'}</p>

      {user?.subscription_status === 'active' && (
        <button
          onClick={handleCancelSubscription}
          style={{
            marginTop: '15px',
            padding: '8px 16px',
            background: '#ef4444',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            borderRadius: '4px',
          }}
        >
          Cancel Subscription
        </button>
      )}

      {user?.subscription_status === 'cancelled' && (
        <button
          onClick={() => {
            window.location.href = '/checkout'
          }}
          style={{
            marginTop: '15px',
            padding: '8px 16px',
            background: '#22c55e',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            borderRadius: '4px',
          }}
        >
          Reactivate Subscription
        </button>
      )}
    </div>
  )
}
