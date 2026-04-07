export default function BillingCard() {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
      }}
    >
      <h2 style={{ marginBottom: '15px', fontSize: '18px', fontWeight: '600' }}>Billing</h2>

      <p style={{ marginBottom: '15px', color: '#6b7280' }}>Manage your billing information and view invoices.</p>

      <button
        onClick={() => {
          window.location.href = '/billing'
        }}
        style={{
          padding: '8px 16px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '4px',
          marginBottom: '10px',
          display: 'block',
          width: '100%',
        }}
      >
        View Billing Details
      </button>

      <button
        onClick={() => {
          window.location.href = '/update-payment-method'
        }}
        style={{
          padding: '8px 16px',
          background: '#6b7280',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '4px',
          display: 'block',
          width: '100%',
        }}
      >
        Update Payment Method
      </button>
    </div>
  )
}
