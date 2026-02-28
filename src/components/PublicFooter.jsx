export default function PublicFooter() {
  return (
    <footer style={{ padding: '2rem 1rem', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
      <p>
        © 2026 HireFlow Inc. All rights reserved. |{' '}
        <a href="/pricing" style={{ color: 'var(--accent)' }}>Pricing</a> |{' '}
        <a href="/privacy" style={{ color: 'var(--accent)' }}>Privacy</a> |{' '}
        <a href="/terms" style={{ color: 'var(--accent)' }}>Terms</a>
      </p>
    </footer>
  )
}
