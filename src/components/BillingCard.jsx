export default function BillingCard() {
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
        <span style={{ fontSize: '20px' }}>💳</span>
        Billing
      </h2>

      <p
        style={{
          color: 'var(--color-text-secondary)',
          marginBottom: '24px',
          lineHeight: '1.6',
          fontSize: '14px',
        }}
      >
        Manage your billing information, view invoices, and update payment methods.
      </p>

      <button
        onClick={() => {
          window.location.href = '/billing'
        }}
        style={{
          display: 'block',
          width: '100%',
          padding: '12px 20px',
          marginBottom: '12px',
          background: 'var(--color-accent-green)',
          color: 'var(--color-bg-primary)',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '600',
          fontSize: '14px',
          transition: 'opacity var(--motion-duration-base) var(--motion-ease-standard)',
        }}
        onMouseEnter={(event) => {
          event.target.style.opacity = '0.9'
        }}
        onMouseLeave={(event) => {
          event.target.style.opacity = '1'
        }}
      >
        View Billing Details
      </button>

      <button
        onClick={() => {
          window.location.href = '/account/payment-method'
        }}
        style={{
          display: 'block',
          width: '100%',
          padding: '12px 20px',
          background: 'var(--color-bg-tertiary)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '600',
          fontSize: '14px',
          transition: 'background-color var(--motion-duration-base) var(--motion-ease-standard)',
        }}
        onMouseEnter={(event) => {
          event.target.style.background = 'var(--color-white-alpha-08)'
        }}
        onMouseLeave={(event) => {
          event.target.style.background = 'var(--color-bg-tertiary)'
        }}
      >
        Update Payment Method
      </button>
    </div>
  )
}
