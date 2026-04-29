export default function PublicFooter() {
  const seoLinks = [
    { href: '/ai-resume-screening', label: 'AI Resume Screening' },
    { href: '/bulk-resume-analysis', label: 'Bulk Resume Analysis' },
    { href: '/resume-scoring-ai', label: 'Resume Scoring AI' },
    { href: '/automated-candidate-shortlisting', label: 'Automated Candidate Shortlisting' },
  ]

  return (
    <footer className="public-footer" aria-label="Hireflow site footer">
      <div className="public-footer__grid">
        <section className="public-footer__column" aria-label="Brand">
          <a className="public-footer__brand" href="/" aria-label="Hireflow home">
            Hireflow
          </a>
          <p className="public-footer__tagline">
            AI-powered resume screening for faster, fairer hiring decisions.
          </p>
        </section>

        <nav className="public-footer__column" aria-label="Product">
          <h3 className="public-footer__heading">Product</h3>
          <ul className="public-footer__list">
            <li><a className="public-footer__link" href="/pricing">Pricing</a></li>
            <li><a className="public-footer__link" href="/demo">Book Demo</a></li>
          </ul>
        </nav>

        <nav className="public-footer__column" aria-label="Company">
          <h3 className="public-footer__heading">Company</h3>
          <ul className="public-footer__list">
            <li><a className="public-footer__link" href="/about">About</a></li>
            <li><a className="public-footer__link" href="/contact">Contact</a></li>
          </ul>
        </nav>

        <nav className="public-footer__column" aria-label="Legal">
          <h3 className="public-footer__heading">Legal</h3>
          <ul className="public-footer__list">
            <li><a className="public-footer__link" href="/privacy">Privacy</a></li>
            <li><a className="public-footer__link" href="/terms">Terms</a></li>
            <li><a className="public-footer__link" href="/refund-policy">Refund Policy</a></li>
          </ul>
        </nav>
      </div>

      <p className="public-footer__copyright">© 2026 Hireflow. All rights reserved.</p>

      <div className="public-footer__intent-links" aria-label="SEO utility links">
        {seoLinks.map(({ href, label }) => (
          <a key={href} className="public-footer__seo-link" href={href}>
            {label}
          </a>
        ))}
      </div>
    </footer>
  )
}
