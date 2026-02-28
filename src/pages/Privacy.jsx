export default function Privacy() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)', padding: '3rem 1rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>Privacy Policy</h1>
        <p style={{ marginBottom: '1rem' }}>
          This is a placeholder Privacy Policy page for HireFlow. A complete Privacy Policy will be published before launch.
        </p>
        <p>
          Return to the <a href="/terms" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Terms &amp; Conditions</a> page.
        </p>
      </div>
    </main>
  )
}
