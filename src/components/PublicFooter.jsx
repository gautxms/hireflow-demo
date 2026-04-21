export default function PublicFooter() {
  return (
    <footer className="public-footer" style={{ padding: '2rem 1rem', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
      <p>
        © 2026 Hireflow. All rights reserved. Visit us at <a className="public-footer__link" href="https://hireflow.dev">hireflow.dev</a>. |{' '}
        <a className="public-footer__link" href="/pricing">Pricing</a> |{' '}
        <a className="public-footer__link" href="/privacy">Privacy</a> |{' '}
        <a className="public-footer__link" href="/terms">Terms</a> |{' '}
        <a className="public-footer__link" href="/refund-policy">Refund Policy</a>
      </p>
    </footer>
  )
}
