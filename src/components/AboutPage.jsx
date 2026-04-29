import { useState } from 'react'
import { Icon } from './Icon'
import PublicPageLayout from './public/PublicPageLayout'

export default function AboutPage({ onBack }) {
  const [selectedTeamMember, setSelectedTeamMember] = useState(null)

  const teamMembers = [
    { id: 1, name: 'Gautam', title: 'Founder & CEO', bio: 'Former Head of Recruiting at Stripe. Passionate about building tools that make hiring human-centric.', expertise: ['Recruiting', 'Product', 'Operations'], image: '👔' },
    { id: 2, name: 'Sarah Chen', title: 'Head of AI/ML', bio: 'PhD in Computer Science from MIT. Built ML systems at OpenAI. Leading our AI scoring engine.', expertise: ['Machine Learning', 'NLP', 'AI Ethics'], image: '🧠' },
    { id: 3, name: 'Marcus Rodriguez', title: 'VP Product', bio: 'Ex-Google, ex-Figma. Obsessed with user experience and building products people love.', expertise: ['Product Design', 'UX', 'Strategy'], image: '🎨' },
    { id: 4, name: 'Priya Sharma', title: 'VP Engineering', bio: 'Led infrastructure at Databricks. Building HireFlow to scale to millions of candidates.', expertise: ['Backend', 'Infrastructure', 'Scalability'], image: '⚙️' }
  ]

  const stats = [{ number: '10K+', label: 'Resumes Analyzed' }, { number: '94%', label: 'Accuracy Rate' }, { number: '45%', label: 'Time Saved for Recruiters' }, { number: '500+', label: 'Companies Using HireFlow' }]
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

  return (
    <PublicPageLayout header={<div className="public-page-header"><button type="button" onClick={onBack} className="public-page-back-button public-nav-text">← Back</button></div>}>
      <div className="public-page-header"><button type="button" onClick={onBack} className="public-page-back-button public-nav-text">← Back</button></div>

      <section className="public-page-hero">
        <h1 className="public-page-title">About HireFlow</h1>
        <p className="public-page-subtitle">We're on a mission to revolutionize hiring by building AI tools that help companies find their best talent. Fast, fair, and human-centric.</p>
      </section>

      <section className="public-section"><div className="about-story"><h2 className="public-section-title">Our Story</h2><p className="public-copy">Gautam spent 5 years as Head of Recruiting at Stripe, building their world-class talent team from scratch. He saw the pain firsthand: recruiters spend 40+ hours per week reading resumes, many of which could be screened by AI in seconds.</p><p className="public-copy">The tools available were either outdated (ATS from 2005) or overly complex (enterprise software that requires a PhD to operate). Gautam knew there had to be a better way.</p><p className="public-copy">In early 2024, he brought together the best ML engineers from OpenAI, Google, and Databricks. Together, they built HireFlow: a modern, AI-powered recruiting tool that's simple, transparent, and actually works.</p><p className="public-copy">Today, 500+ companies use HireFlow to hire faster and smarter. We're just getting started.</p></div></section>

      <section className="public-section public-section-alt"><div className="public-page-main"><h2 className="public-section-title center">By The Numbers</h2><div className="public-feature-grid">{stats.map((stat) => <article key={stat.label} className="public-card contact-center-card"><div className="public-page-title contact-accent-title">{stat.number}</div><p className="public-card-copy">{stat.label}</p></article>)}</div></div></section>

      <section className="public-section public-page-main"><h2 className="public-section-title center">Our Values</h2><div className="public-feature-grid">{values.map((value) => <article key={value.title} className="public-card"><Icon name={value.icon} size="xl" tone="accent" className="contact-icon" /><h3 className="public-card-title">{value.title}</h3><p className="public-card-copy">{value.description}</p></article>)}</div></section>

      <section className="public-section public-section-alt"><div className="public-page-main"><h2 className="public-section-title center">Meet the Team</h2><div className="public-feature-grid">{teamMembers.map((member) => <article key={member.id} className={`public-card about-team-card ${selectedTeamMember?.id === member.id ? 'active' : ''}`} onClick={() => setSelectedTeamMember(member)}><div className="about-team-avatar">{member.image}</div><h3 className="public-card-title">{member.name}</h3><p className="public-card-copy contact-accent-title">{member.title}</p>{selectedTeamMember?.id === member.id && <div className="about-team-meta"><p className="public-card-copy">{member.bio}</p><div className="about-pill-list">{member.expertise.map((skill) => <span key={skill} className="public-pill">{skill}</span>)}</div></div>}</article>)}</div><p className="public-copy center">Click a team member to learn more</p></div></section>

      <section className="public-section public-page-main"><h2 className="public-section-title center">What Customers Say</h2><div className="public-feature-grid">{testimonials.map((testimonial) => <article key={testimonial.author} className="public-card"><p className="public-copy">"{testimonial.quote}"</p><div className="about-team-meta"><div className="public-card-title">{testimonial.author}</div><div className="public-card-copy contact-accent-title">{testimonial.role}</div><div className="public-card-copy">{testimonial.company}</div></div></article>)}</div></section>

      <section className="public-section public-section-alt"><div className="about-timeline"><h2 className="public-section-title center">Our Journey</h2>{timeline.map((item) => <article key={item.year} className="public-card about-timeline-item"><h3 className="public-card-title contact-accent-title">{item.year}</h3><p className="public-card-title">{item.event}</p><p className="public-card-copy">{item.desc}</p></article>)}</div></section>

      <footer className="public-cta-footer"><h2 className="public-section-title">Join us on the mission</h2><p className="public-copy center">Start using HireFlow today and transform your hiring process</p><div className="public-button-row center"><a className="public-btn-primary" href="/contact">Contact Support</a><a className="public-btn-secondary" href="/demo">Schedule Demo</a></div></footer>
    </PublicPageLayout>
  )
}
