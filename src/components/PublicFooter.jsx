import { useEffect, useState } from 'react'

export default function PublicFooter() {
  const seoLinks = [
    { href: '/ai-resume-screening', label: 'AI Resume Screening' },
    { href: '/bulk-resume-analysis', label: 'Bulk Resume Analysis' },
    { href: '/resume-scoring-ai', label: 'Resume Scoring AI' },
    { href: '/automated-candidate-shortlisting', label: 'Automated Candidate Shortlisting' },
  ]
  const [isSeoExpanded, setIsSeoExpanded] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 601px)')
    const updateExpandedState = (event) => {
      setIsSeoExpanded(event.matches)
    }

    setIsSeoExpanded(mediaQuery.matches)
    mediaQuery.addEventListener('change', updateExpandedState)

    return () => mediaQuery.removeEventListener('change', updateExpandedState)
  }, [])

  return (
    <footer className="public-footer" aria-label="Hireflow site footer">
      <div className="public-footer__grid">
        <section className="public-footer__column" aria-label="Brand">
          <a className="public-footer__brand" href="/" aria-label="Hireflow home">
            Hire<span>Flow</span>
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

      <div className="public-footer__intent" aria-label="SEO utility links">
        <button
          type="button"
          className="public-footer__intent-toggle"
          aria-expanded={isSeoExpanded}
          aria-controls="public-footer-intent-links"
          onClick={() => setIsSeoExpanded((expanded) => !expanded)}
        >
          SEO links
        </button>

        <div
          id="public-footer-intent-links"
          className={`public-footer__intent-links ${isSeoExpanded ? 'public-footer__intent-links--expanded' : ''}`.trim()}
        >
          {seoLinks.map(({ href, label }) => (
            <a key={href} className="public-footer__seo-link" href={href}>
              {label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
