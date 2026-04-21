import { useEffect, useState } from 'react'
import '../globals.css'

export default function LandingPage({ ctaLabel = 'Try Free Demo' }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    // Smooth scroll and interactive effects
    const anchors = document.querySelectorAll('a[href^="#"]')
    const clickHandlers = []

    anchors.forEach(anchor => {
      const handler = function (e) {
        e.preventDefault()
        const target = document.querySelector(this.getAttribute('href'))
        if (target) target.scrollIntoView({ behavior: 'smooth' })
      }
      clickHandlers.push({ anchor, handler })
      anchor.addEventListener('click', handler)
    })

    return () => {
      clickHandlers.forEach(({ anchor, handler }) => {
        anchor.removeEventListener('click', handler)
      })
    }
  }, [])

  return (
    <>
      <div className="landing-mobile-header">
        <button
          type="button"
          className="landing-menu-toggle"
          aria-label="Toggle landing navigation"
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <a href="/pricing" className="btn-primary landing-mobile-cta">Start Demo</a>
      </div>

      {isMobileMenuOpen && (
        <div className="landing-mobile-menu" aria-label="Mobile site links">
          <a href="#features" onClick={() => setIsMobileMenuOpen(false)}>Features</a>
          <a href="/pricing" className="btn-ghost" onClick={() => setIsMobileMenuOpen(false)}>Try Demo</a>
        </div>
      )}

      {/* Hero Section */}
      <section className="hero">
        <div className="orb-2"></div>
        <div className="hero-content">
          <h1 className="hero-headline">
            <span className="hero-headline-line">Hire</span>
            <span className="hero-headline-line">Smarter.</span>
            <span className="hero-headline-line hero-headline-line--accent">Faster.</span>
          </h1>
          <p>
            HireFlow automates candidate screening with AI. Reduce hiring time from weeks to days, 
            eliminate bias, and make data-driven decisions. Finally, a recruiting tool built for modern teams.
            Explore our <a href="/ai-resume-screening">AI resume screening software</a> guide or compare <a href="/candidate-ranking-software">candidate ranking software</a> workflows.
          </p>
          <div className="hero-cta">
            <a className="btn-primary" href="/pricing" aria-label={`${ctaLabel} on the pricing page`}>
              {ctaLabel}
            </a>
            <a className="btn-ghost" href="/demo">Watch 2-min Demo</a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" id="features">
        <div className="public-page-main" style={{ marginBottom: '1.5rem' }}>
          <p className="public-copy center">
            Need implementation details? Visit the <a href="/help">Help Center</a>, review <a href="/pricing">pricing plans</a>, or <a href="/contact">talk with our team</a>.
          </p>
        </div>
        <div className="features-grid">
          <div className="feature-card">
            <h3>⚡ AI Screening</h3>
            <p>Automatically analyze and score resumes in seconds. Match candidates with roles using 20+ evaluation dimensions.</p>
          </div>
          <div className="feature-card">
            <h3>🎯 Bias Removal</h3>
            <p>Our AI evaluates candidates on merit, not on demographics. Fair, transparent, and legally defensible.</p>
          </div>
          <div className="feature-card">
            <h3>📊 Smart Analytics</h3>
            <p>Track hiring metrics, time-to-hire, and candidate quality. Data-driven insights for continuous improvement.</p>
          </div>
          <div className="feature-card">
            <h3>🔗 ATS Integration</h3>
            <p>Works seamlessly with your existing tools. No workflow disruption, just smarter hiring.</p>
          </div>
          <div className="feature-card">
            <h3>💰 Cost Savings</h3>
            <p>Reduce time-to-hire by 70%. Save $3-5K per hire by eliminating manual screening.</p>
          </div>
          <div className="feature-card">
            <h3>🔐 Privacy First</h3>
            <p>SOC 2 compliant. Your candidate data is encrypted and never shared. Enterprise-grade security.</p>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="public-page-main">
          <h2 className="public-section-title center">Explore hiring guides</h2>
          <p className="public-copy center">
            Start from the homepage and reach every core page and SEO guide in one click.
          </p>
          <div className="public-feature-grid">
            <article className="public-card">
              <h3 className="public-card-title"><a href="/ai-resume-screening">AI Resume Screening</a></h3>
              <p className="public-card-copy">Learn how to automate first-pass resume review while keeping human oversight.</p>
            </article>
            <article className="public-card">
              <h3 className="public-card-title"><a href="/candidate-ranking-software">Candidate Ranking Software</a></h3>
              <p className="public-card-copy">See scoring frameworks that prioritize qualified candidates faster.</p>
            </article>
            <article className="public-card">
              <h3 className="public-card-title"><a href="/recruiting-automation-tools">Recruiting Automation Tools</a></h3>
              <p className="public-card-copy">Discover automation workflows for sourcing, screening, and pipeline handoffs.</p>
            </article>
          </div>
        </div>
      </section>
    </>
  )
}
