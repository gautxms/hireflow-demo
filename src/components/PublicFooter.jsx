export default function PublicFooter() {
  return (
    <footer className="public-footer" style={{ padding: '2rem 1rem', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
      <p>
        © 2026 Hireflow. All rights reserved. |{' '}
        <a className="public-footer__link" href="/pricing">Pricing</a> |{' '}
        <a className="public-footer__link" href="/demo">Demo</a> |{' '}
        <a className="public-footer__link" href="/privacy">Privacy</a> |{' '}
        <a className="public-footer__link" href="/terms">Terms</a> |{' '}
        <a className="public-footer__link" href="/refund-policy">Refund Policy</a>
      </p>
      <p style={{ marginTop: '0.75rem' }}>
        <a className="public-footer__link" href="/ai-resume-screening">AI Resume Screening</a> |{' '}
        <a className="public-footer__link" href="/bulk-resume-analysis">Bulk Resume Analysis</a> |{' '}
        <a className="public-footer__link" href="/resume-scoring-ai">Resume Scoring AI</a> |{' '}
        <a className="public-footer__link" href="/automated-candidate-shortlisting">Automated Candidate Shortlisting</a>
      </p>
    </footer>
  )
}
