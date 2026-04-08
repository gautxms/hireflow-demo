const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export default function SubscriptionCard({ user, token, onRefresh, subscription }) {
  const getStatusColor = (status) => {
    const colors = {
      active: '#CCFF00',
      trialing: '#3b82f6',
      cancelled: '#ef4444',
      past_due: '#f59e0b',
    }

    return colors[status] || '#9ca3af'
  }

  const getStatusTextColor = (status) => (status === 'active' ? '#000000' : '#ffffff')

  const handleCancelSubscription = async () => {
    if (!window.confirm('Cancel subscription? You\'ll lose access after the current period.')) return

    try {
      const response = await fetch(`${API_BASE_URL}/api/subscriptions/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'Cancelled from account page', acceptOffer: false }),
      })

      if (!response.ok) {
        throw new Error('Failed to cancel subscription')
      }

      onRefresh?.()
    } catch (error) {
      console.error('Failed to cancel subscription', error)
    }
  }

  const status = subscription?.status || user?.subscription_status || 'inactive'
  const plan = subscription?.plan || user?.subscription_plan || 'N/A'
  const startedAt = subscription?.started_date || user?.subscription_started_at || null
  const hasSubscription = Boolean(subscription || user?.subscription_plan || user?.subscription_status === 'active' || user?.subscription_status === 'trialing')

  return (
    <div
      style={{
        background: '#1a1a1a',
        border: '1px solid #333333',
        borderRadius: '12px',
        padding: '28px',
      }}
    >
      <h2
        style={{
          fontSize: '18px',
          fontWeight: '600',
          color: '#ffffff',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '20px' }}>📦</span>
        Subscription
      </h2>

      <div style={{ marginBottom: '16px' }}>
        <p
          style={{
            fontSize: '12px',
            color: '#a3a3a3',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Status
        </p>
        <span
          style={{
            display: 'inline-block',
            padding: '6px 16px',
            background: getStatusColor(status),
            color: getStatusTextColor(status),
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}
        >
          {status}
        </span>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <p
          style={{
            fontSize: '12px',
            color: '#a3a3a3',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Plan
        </p>
        <p style={{ color: '#ffffff', fontSize: '14px', textTransform: 'capitalize' }}>{plan || 'N/A'}</p>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <p
          style={{
            fontSize: '12px',
            color: '#a3a3a3',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Started
        </p>
        <p style={{ color: '#ffffff', fontSize: '14px' }}>
          {startedAt
            ? new Date(startedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : 'N/A'}
        </p>
      </div>

      {hasSubscription && status === 'active' && (
        <button
          onClick={handleCancelSubscription}
          style={{
            width: '100%',
            padding: '12px 20px',
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#ef4444',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '14px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(event) => {
            event.target.style.background = '#ef4444'
            event.target.style.color = '#ffffff'
          }}
          onMouseLeave={(event) => {
            event.target.style.background = 'rgba(239, 68, 68, 0.2)'
            event.target.style.color = '#ef4444'
          }}
        >
          Cancel Subscription
        </button>
      )}

      {status === 'cancelled' && (
        <button
          onClick={() => {
            window.location.href = '/checkout'
          }}
          style={{
            width: '100%',
            padding: '12px 20px',
            background: '#CCFF00',
            color: '#000000',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '14px',
          }}
        >
          Reactivate Subscription
        </button>
      )}
    </div>
  )
}
