import { Icon } from './Icon'
import PublicPageLayout from './public/PublicPageLayout'

export default function AboutPage({ onBack }) {
  const stats = [
    { number: 'Feb 2026', label: 'Started building HireFlow' },
    { number: '100+', label: 'Resumes tested during product development' },
    { number: '1,000+', label: 'Candidate signals evaluated across skills, experience, gaps, and JD matches' },
    { number: 'Launch-ready', label: 'Core screening workflows preparing for release' }
  ]
  const values = [
    { icon: 'target', title: 'User-Centric', description: 'Everything we build starts with understanding real recruiting pain points.' },
    { icon: 'microscope', title: 'AI-Powered', description: 'Advanced machine learning that learns and improves with every hire.' },
    { icon: 'chart', title: 'Transparent', description: 'You always know how we scored candidates and can customize the rules.' },
    { icon: 'rocket', title: 'Fast', description: 'From resume to ranked candidates in minutes, not days.' },
    { icon: 'shield', title: 'Trustworthy', description: 'Enterprise-grade security and compliance. Your data is safe with us.' },
    { icon: 'sprout', title: 'Bias-Aware', description: 'Built to reduce bias and promote diversity in hiring.' }
  ]
  const testimonials = [
    { quote: 'HireFlow cut our screening time by 60%. We now focus on the best candidates instead of manual review.', author: 'Jane Smith', company: 'TechCorp', role: 'Head of Recruiting' },
    { quote: 'The accuracy is incredible. Our hiring decisions are now data-driven, not gut-based.', author: 'David Kim', company: 'StartupXYZ', role: 'Founder & CEO' },
    { quote: 'Best recruiting tool we\'ve invested in. ROI was immediate. Highly recommend.', author: 'Rachel Goldman', company: 'Fortune 500 Tech', role: 'CHRO' }
  ]
  const timeline = [
    { year: '2024', event: 'HireFlow Founded', desc: 'Gautam left Stripe to fix recruiting.' },
    { year: '2024 Q2', event: 'Alpha Launch', desc: '50 beta customers onboarded.' },
    { year: '2024 Q3', event: 'Series A Seed', desc: '$2M funding to scale.' },
    { year: '2025', event: 'Enterprise Launch', desc: 'API + custom integrations available.' },
    { year: '2025 Q2', event: 'IPO Goals', desc: 'Become the standard for AI hiring.' }
  ]
  const focusAreas = [
    { title: 'Recruiters', description: 'Quickly review candidate strengths, experience signals, and fit indicators without manual spreadsheet triage.' },
    { title: 'Founders & small teams', description: 'Run a consistent hiring workflow even when hiring is shared across a lean team with limited recruiting bandwidth.' },
    { title: 'Hiring managers', description: 'Get structured candidate context tied directly to role needs so interview planning and decisions are clearer.' },
    { title: 'Early-stage teams', description: 'Set up practical screening processes early and keep quality high as hiring volume increases.' }
  ]

  return (
    <PublicPageLayout header={<div className="public-page-header"><button type="button" onClick={onBack} className="public-page-back-button public-nav-text" aria-label="Back to home">← Back to Home</button></div>}>

      <section className="public-page-hero">
        <h1 className="public-page-title">About HireFlow</h1>
        <p className="public-page-subtitle">We're on a mission to revolutionize hiring by building AI tools that help companies find their best talent. Fast, fair, and human-centric.</p>
      </section>

      <section className="public-section"><div className="about-story"><h2 className="public-section-title">Our Story</h2><p className="public-copy">HireFlow started in February 2026 with a clear goal: make early-stage hiring faster, more consistent, and easier to manage.</p><p className="public-copy">We built HireFlow for recruiters, founders, and small teams who need a practical way to screen candidates without adding complicated tools to their process.</p><p className="public-copy">Our AI is designed as decision support, not recruiter replacement—helping teams reason through profiles, surface strengths and gaps, map skills, and evaluate job-description fit with clearer context.</p><p className="public-copy">Today, we are preparing for launch with a focused workflow: create a job description, upload resumes, run analysis, review ranked candidates, and shortlist the best matches.</p></div></section>

      <section className="public-section public-section-alt"><div className="public-page-main"><h2 className="public-section-title center">By The Numbers</h2><div className="public-feature-grid">{stats.map((stat) => <article key={stat.label} className="public-card contact-center-card"><div className="public-page-title contact-accent-title">{stat.number}</div><p className="public-card-copy">{stat.label}</p></article>)}</div></div></section>

      <section className="public-section public-page-main"><h2 className="public-section-title center">Our Values</h2><div className="public-feature-grid">{values.map((value) => <article key={value.title} className="public-card"><Icon name={value.icon} size="xl" tone="accent" className="contact-icon" /><h3 className="public-card-title">{value.title}</h3><p className="public-card-copy">{value.description}</p></article>)}</div></section>

      <section className="public-section public-section-alt"><div className="public-page-main"><h2 className="public-section-title center">Built for focused hiring teams</h2><div className="public-feature-grid">{focusAreas.map((area) => <article key={area.title} className="public-card"><h3 className="public-card-title">{area.title}</h3><p className="public-card-copy">{area.description}</p></article>)}</div></div></section>

      <section className="public-section public-page-main"><h2 className="public-section-title center">What Customers Say</h2><div className="public-feature-grid">{testimonials.map((testimonial) => <article key={testimonial.author} className="public-card"><p className="public-copy">"{testimonial.quote}"</p><div className="about-team-meta"><div className="public-card-title">{testimonial.author}</div><div className="public-card-copy contact-accent-title">{testimonial.role}</div><div className="public-card-copy">{testimonial.company}</div></div></article>)}</div></section>

      <section className="public-section public-section-alt"><div className="about-timeline"><h2 className="public-section-title center">Our Journey</h2>{timeline.map((item) => <article key={item.year} className="public-card about-timeline-item"><h3 className="public-card-title contact-accent-title">{item.year}</h3><p className="public-card-title">{item.event}</p><p className="public-card-copy">{item.desc}</p></article>)}</div></section>

      <footer className="public-cta-footer"><h2 className="public-section-title">Join us on the mission</h2><p className="public-copy center">Start using HireFlow today and transform your hiring process</p><div className="public-button-row center"><a className="public-btn-primary" href="/contact">Contact Support</a><a className="public-btn-secondary" href="/demo">Schedule Demo</a></div></footer>
    </PublicPageLayout>
  )
}
