export default function PublicFooter() {
  return (
    <footer className="public-footer" style={{ padding: '2rem 1rem', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
      <p>
        © 2026 Hireflow. All rights reserved. |{' '}
        <a className="public-footer__link" href="/about">About</a> |{' '}
        <a className="public-footer__link" href="/help">Help</a> |{' '}
        <a className="public-footer__link" href="/contact">Contact</a> |{' '}
        <a className="public-footer__link" href="/demo">Demo</a> |{' '}
        <a className="public-footer__link" href="/pricing">Pricing</a> |{' '}
        <a className="public-footer__link" href="/privacy">Privacy</a> |{' '}
        <a className="public-footer__link" href="/terms">Terms</a> |{' '}
        <a className="public-footer__link" href="/refund-policy">Refund Policy</a> |{' '}
        <a className="public-footer__link" href="/ai-resume-screening">AI Resume Screening</a> |{' '}
        <a className="public-footer__link" href="/candidate-ranking-software">Candidate Ranking</a> |{' '}
        <a className="public-footer__link" href="/recruiting-automation-tools">Recruiting Automation</a>
      </p>
    </footer>
  )
}
