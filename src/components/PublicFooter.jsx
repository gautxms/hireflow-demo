import { openCookiePreferences } from '../privacy/cookieConsent'

const LINKEDIN_COMPANY_URL = 'https://www.linkedin.com/company/hireflow-dev/'

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
            Hire<span>Flow</span>
          </a>
          <p className="public-footer__tagline">
            AI-assisted resume screening for faster, more structured candidate review.
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
            <li><a className="public-footer__link" href="/trust">Trust</a></li>
            <li>
              <a
                className="public-footer__link"
                href={LINKEDIN_COMPANY_URL}
                target="_blank"
                rel="noreferrer"
              >
                LinkedIn
              </a>
            </li>
          </ul>
        </nav>

        <nav className="public-footer__column" aria-label="Legal">
          <h3 className="public-footer__heading">Legal</h3>
          <ul className="public-footer__list">
            <li><a className="public-footer__link" href="/privacy">Privacy</a></li>
            <li><a className="public-footer__link" href="/terms">Terms</a></li>
            <li><a className="public-footer__link" href="/ai-disclosure">AI Disclosure</a></li>
            <li><a className="public-footer__link" href="/cookie-policy">Cookie Policy</a></li>
            <li><a className="public-footer__link" href="/refund-policy">Refund Policy</a></li>
          </ul>
        </nav>
      </div>

      <p className="public-footer__trust-copy">Privacy-conscious by design. Necessary cookies keep your account secure; optional analytics help us improve HireFlow.</p>

      <div className="public-footer__utility" aria-label="Privacy controls">
        <button type="button" className="public-footer__button-link" onClick={openCookiePreferences}>Cookie preferences</button>
        <a className="public-footer__button-link" href="/cookie-policy">Cookie Policy</a>
      </div>

      <p className="public-footer__copyright">© 2026 Hireflow. All rights reserved.</p>

      <div className="public-footer__intent" aria-label="SEO utility links">
        <div id="public-footer-intent-links" className="public-footer__intent-links footer-seo">
          {seoLinks.map(({ href, label }, index) => (
            <span key={href}>
              {index > 0 && <span className="sep" aria-hidden="true">|</span>}
              <a className="public-footer__seo-link" href={href}>
                {label}
              </a>
            </span>
          ))}
        </div>
      </div>
    </footer>
  )
}
