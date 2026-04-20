export default function PublicFooter() {
  return (
    <footer style={{ padding: '2rem 1rem', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
      <p>
        © 2026 Hireflow. All rights reserved. |{' '}
        <a href="/pricing" style={{ color: 'var(--color-accent-green)' }}>Pricing</a> |{' '}
        <a href="/privacy" style={{ color: 'var(--color-accent-green)' }}>Privacy</a> |{' '}
        <a href="/terms" style={{ color: 'var(--color-accent-green)' }}>Terms</a> |{' '}
        <a href="/refund-policy" style={{ color: 'var(--color-accent-green)' }}>Refund Policy</a>
      </p>
    </footer>
  )
}
