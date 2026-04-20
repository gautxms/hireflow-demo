export default function BillingCard() {
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
        <span style={{ fontSize: '20px' }}>💳</span>
        Billing
      </h2>

      <p
        style={{
          color: '#a3a3a3',
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
          background: '#CCFF00',
          color: '#000000',
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
          background: '#333333',
          color: '#ffffff',
          border: '1px solid #555555',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '600',
          fontSize: '14px',
          transition: 'background-color var(--motion-duration-base) var(--motion-ease-standard)',
        }}
        onMouseEnter={(event) => {
          event.target.style.background = '#444444'
        }}
        onMouseLeave={(event) => {
          event.target.style.background = '#333333'
        }}
      >
        Update Payment Method
      </button>
    </div>
  )
}
