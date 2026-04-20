import API_BASE from '../config/api'
export default function SubscriptionCard({ user, token, onRefresh, subscription }) {
  const getStatusColor = (status) => {
    const colors = {
      active: 'var(--color-accent-green)',
      trialing: 'var(--color-info)',
      cancelled: 'var(--color-error)',
      past_due: 'var(--color-warning-text)',
    }

    return colors[status] || 'var(--color-text-muted)'
  }

  const getStatusTextColor = (status) => (status === 'active' ? 'var(--color-bg-primary)' : 'var(--color-text-primary)')

  const handleCancelSubscription = async () => {
    if (!window.confirm('Cancel subscription? You\'ll lose access after the current period.')) return

    try {
      const response = await fetch(`${API_BASE}/subscriptions/cancel`, {
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
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '28px',
      }}
    >
      <h2
        style={{
          fontSize: '18px',
          fontWeight: '600',
          color: 'var(--color-text-primary)',
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
            color: 'var(--color-text-secondary)',
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
            color: 'var(--color-text-secondary)',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Plan
        </p>
        <p style={{ color: 'var(--color-text-primary)', fontSize: '14px', textTransform: 'capitalize' }}>{plan || 'N/A'}</p>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <p
          style={{
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Started
        </p>
        <p style={{ color: 'var(--color-text-primary)', fontSize: '14px' }}>
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
            background: 'var(--color-danger-alpha-15)',
            color: 'var(--color-error)',
            border: '1px solid var(--color-error)',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '14px',
            transition: 'all var(--motion-duration-base) var(--motion-ease-standard)',
          }}
          onMouseEnter={(event) => {
            event.target.style.background = 'var(--color-error)'
            event.target.style.color = 'var(--color-text-primary)'
          }}
          onMouseLeave={(event) => {
            event.target.style.background = 'var(--color-danger-alpha-15)'
            event.target.style.color = 'var(--color-error)'
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
            background: 'var(--color-accent-green)',
            color: 'var(--color-bg-primary)',
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
