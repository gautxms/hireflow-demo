import { useEffect } from 'react'
import '../globals.css'

export default function LandingPage({ onStartDemo, onViewPricing, onViewDashboard, onViewAbout, onViewDemo, onViewContact, onViewHelp }) {
  useEffect(() => {
    // Smooth scroll and interactive effects
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault()
        const target = document.querySelector(this.getAttribute('href'))
        if (target) target.scrollIntoView({ behavior: 'smooth' })
      })
    })
  }, [])

  return (
    <>
      {/* Navigation */}
      <nav>
        <div className="nav-logo">
          Hire<span>Flow</span>
        </div>
        <ul className="nav-links">
          <li><a href="#features">Features</a></li>
          <li><button onClick={onViewPricing} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '400', letterSpacing: '0.02em' }}>Pricing</button></li>
          <li><button onClick={onViewAbout} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '400', letterSpacing: '0.02em' }}>About</button></li>
          <li><button onClick={onViewHelp} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '400', letterSpacing: '0.02em' }}>Help</button></li>
        </ul>
        <div className="nav-cta">
          <button className="btn-ghost" onClick={onViewContact}>Contact</button>
          <button className="btn-primary" onClick={onStartDemo}>Get Started</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="orb-2"></div>
        <div className="hero-content">
          <h1>
            Hire Smarter.
            <br />
            <span className="gradient">Faster.</span>
          </h1>
          <p>
            HireFlow provides transparent PDF resume text extraction so hiring teams can review exactly what is read from each file. No scoring, no ranking, just the raw output.
          </p>
          <div className="hero-cta">
            <button className="btn-primary" onClick={onStartDemo} style={{ fontSize: '1rem', padding: '0.75rem 2rem' }}>
              Try Free Demo
            </button>
            <button className="btn-ghost">Watch 2-min Demo</button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" id="features">
        <div className="features-grid">
          <div className="feature-card">
            <h3>⚡ Resume Text Extraction</h3>
            <p>Extract readable text from uploaded resumes and display deterministic fields from that text.</p>
          </div>
          <div className="feature-card">
            <h3>🎯 Deterministic Parsing</h3>
            <p>Detect candidate name, email, phone, and common sections using simple rule-based parsing.</p>
          </div>
          <div className="feature-card">
            <h3>📊 Honest Output</h3>
            <p>See the raw extracted text directly so teams can validate every parsed result.</p>
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

      {/* Footer */}
      <footer>
        <p>© 2026 HireFlow Inc. All rights reserved. | <a href="#" style={{ color: 'var(--accent)' }}>Privacy</a> | <a href="#" style={{ color: 'var(--accent)' }}>Terms</a></p>
      </footer>
    </>
  )
}
