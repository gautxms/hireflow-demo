import { useState } from 'react'

export default function AboutPage({ onBack }) {
  const [selectedTeamMember, setSelectedTeamMember] = useState(null)

  const teamMembers = [
    {
      id: 1,
      name: 'Gautam',
      title: 'Founder & CEO',
      bio: 'Former Head of Recruiting at Stripe. Passionate about building tools that make hiring human-centric.',
      expertise: ['Recruiting', 'Product', 'Operations'],
      image: '👔'
    },
    {
      id: 2,
      name: 'Sarah Chen',
      title: 'Head of AI/ML',
      bio: 'PhD in Computer Science from MIT. Built ML systems at OpenAI. Leading our AI scoring engine.',
      expertise: ['Machine Learning', 'NLP', 'AI Ethics'],
      image: '🧠'
    },
    {
      id: 3,
      name: 'Marcus Rodriguez',
      title: 'VP Product',
      bio: 'Ex-Google, ex-Figma. Obsessed with user experience and building products people love.',
      expertise: ['Product Design', 'UX', 'Strategy'],
      image: '🎨'
    },
    {
      id: 4,
      name: 'Priya Sharma',
      title: 'VP Engineering',
      bio: 'Led infrastructure at Databricks. Building HireFlow to scale to millions of candidates.',
      expertise: ['Backend', 'Infrastructure', 'Scalability'],
      image: '⚙️'
    }
  ]

  const stats = [
    { number: '10K+', label: 'Resumes Analyzed' },
    { number: '94%', label: 'Accuracy Rate' },
    { number: '45%', label: 'Time Saved for Recruiters' },
    { number: '500+', label: 'Companies Using HireFlow' }
  ]

  const values = [
    {
      icon: '🎯',
      title: 'User-Centric',
      description: 'Everything we build starts with understanding real recruiting pain points.'
    },
    {
      icon: '🔬',
      title: 'AI-Powered',
      description: 'Advanced machine learning that learns and improves with every hire.'
    },
    {
      icon: '📊',
      title: 'Transparent',
      description: 'You always know how we scored candidates and can customize the rules.'
    },
    {
      icon: '🚀',
      title: 'Fast',
      description: 'From resume to ranked candidates in minutes, not days.'
    },
    {
      icon: '🤝',
      title: 'Trustworthy',
      description: 'Enterprise-grade security and compliance. Your data is safe with us.'
    },
    {
      icon: '🌱',
      title: 'Bias-Aware',
      description: 'Built to reduce bias and promote diversity in hiring.'
    }
  ]

  const testimonials = [
    {
      quote: 'HireFlow cut our screening time by 60%. We now focus on the best candidates instead of manual review.',
      author: 'Jane Smith',
      company: 'TechCorp',
      role: 'Head of Recruiting'
    },
    {
      quote: 'The accuracy is incredible. Our hiring decisions are now data-driven, not gut-based.',
      author: 'David Kim',
      company: 'StartupXYZ',
      role: 'Founder & CEO'
    },
    {
      quote: 'Best recruiting tool we\'ve invested in. ROI was immediate. Highly recommend.',
      author: 'Rachel Goldman',
      company: 'Fortune 500 Tech',
      role: 'CHRO'
    }
  ]

  const timeline = [
    { year: '2024', event: 'HireFlow Founded', desc: 'Gautam left Stripe to fix recruiting.' },
    { year: '2024 Q2', event: 'Alpha Launch', desc: '50 beta customers onboarded.' },
    { year: '2024 Q3', event: 'Series A Seed', desc: '$2M funding to scale.' },
    { year: '2025', event: 'Enterprise Launch', desc: 'API + custom integrations available.' },
    { year: '2025 Q2', event: 'IPO Goals', desc: 'Become the standard for AI hiring.' }
  ]

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '2rem 4rem' }}>
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--accent)',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.9rem'
          }}
        >
          ← Back
        </button>
      </div>

      {/* Hero Section */}
      <div style={{ padding: '6rem 4rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1.5rem', fontFamily: 'var(--font-display)' }}>
          About HireFlow
        </h1>
        <p style={{ fontSize: '1.2rem', color: 'var(--muted)', maxWidth: '700px', margin: '0 auto', lineHeight: '1.8' }}>
          We're on a mission to revolutionize hiring by building AI tools that help companies find their best talent. Fast, fair, and human-centric.
        </p>
      </div>

      {/* Our Story */}
      <div style={{ padding: '4rem', maxWidth: '900px', margin: '0 auto', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem', fontFamily: 'var(--font-display)' }}>
          Our Story
        </h2>

        <div style={{ display: 'grid', gap: '2rem', color: 'var(--muted)', lineHeight: '1.8' }}>
          <p>
            Gautam spent 5 years as Head of Recruiting at Stripe, building their world-class talent team from scratch. He saw the pain firsthand: recruiters spend 40+ hours per week reading resumes, many of which could be screened by AI in seconds.
          </p>

          <p>
            The tools available were either outdated (ATS from 2005) or overly complex (enterprise software that requires a PhD to operate). Gautam knew there had to be a better way.
          </p>

          <p>
            In early 2024, he brought together the best ML engineers from OpenAI, Google, and Databricks. Together, they built HireFlow: a modern, AI-powered recruiting tool that's simple, transparent, and actually works.
          </p>

          <p>
            Today, 500+ companies use HireFlow to hire faster and smarter. We're just getting started.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: '4rem', background: 'var(--ink-2)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '3rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
            By The Numbers
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem' }}>
            {stats.map((stat, i) => (
              <div key={i} style={{ textAlign: 'center', padding: '2rem', background: 'var(--card)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--accent)', marginBottom: '0.5rem' }}>
                  {stat.number}
                </div>
                <div style={{ color: 'var(--muted)' }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Values */}
      <div style={{ padding: '4rem', maxWidth: '1200px', margin: '0 auto', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '3rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
          Our Values
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
          {values.map((value, i) => (
            <div
              key={i}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '2rem',
                transition: 'all 0.3s'
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>
                {value.icon}
              </div>
              <h3 style={{ fontWeight: 'bold', marginBottom: '0.75rem' }}>
                {value.title}
              </h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: '1.6' }}>
                {value.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Team */}
      <div style={{ padding: '4rem', background: 'var(--ink-2)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '3rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
            Meet the Team
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
            {teamMembers.map(member => (
              <div
                key={member.id}
                onClick={() => setSelectedTeamMember(member)}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '2rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                  transform: selectedTeamMember?.id === member.id ? 'scale(1.05)' : 'scale(1)'
                }}
              >
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
                  {member.image}
                </div>
                <h3 style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                  {member.name}
                </h3>
                <p style={{ color: 'var(--accent)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  {member.title}
                </p>

                {selectedTeamMember?.id === member.id && (
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                    <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1rem' }}>
                      {member.bio}
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                      {member.expertise.map((skill, i) => (
                        <span
                          key={i}
                          style={{
                            background: 'rgba(232,255,90,0.15)',
                            color: 'var(--accent)',
                            padding: '0.4rem 0.8rem',
                            borderRadius: '4px',
                            fontSize: '0.8rem'
                          }}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <p style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '2rem', fontSize: '0.9rem' }}>
            Click a team member to learn more
          </p>
        </div>
      </div>

      {/* Testimonials */}
      <div style={{ padding: '4rem', maxWidth: '1200px', margin: '0 auto', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '3rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
          What Customers Say
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          {testimonials.map((testimonial, i) => (
            <div
              key={i}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '2rem',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <p style={{ fontSize: '1.1rem', marginBottom: '1.5rem', lineHeight: '1.8', color: 'var(--text)' }}>
                "{testimonial.quote}"
              </p>
              <div style={{ marginTop: 'auto', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 'bold' }}>
                  {testimonial.author}
                </div>
                <div style={{ color: 'var(--accent)', fontSize: '0.9rem' }}>
                  {testimonial.role}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                  {testimonial.company}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div style={{ padding: '4rem', background: 'var(--ink-2)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '3rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
            Our Journey
          </h2>

          <div style={{ position: 'relative' }}>
            {/* Timeline line */}
            <div style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: '2px',
              background: 'var(--accent)',
              transform: 'translateX(-50%)'
            }} />

            {/* Timeline items */}
            <div style={{ display: 'grid', gap: '3rem' }}>
              {timeline.map((item, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'center' }}>
                  <div style={{ textAlign: i % 2 === 0 ? 'right' : 'left' }}>
                    {i % 2 === 0 && (
                      <div style={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '1.5rem'
                      }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)', marginBottom: '0.5rem' }}>
                          {item.year}
                        </div>
                        <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                          {item.event}
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                          {item.desc}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Timeline dot */}
                  <div style={{
                    width: '16px',
                    height: '16px',
                    background: 'var(--accent)',
                    borderRadius: '50%',
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    border: `4px solid var(--ink-2)`
                  }} />

                  <div style={{ textAlign: i % 2 === 1 ? 'left' : 'right' }}>
                    {i % 2 === 1 && (
                      <div style={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '1.5rem'
                      }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)', marginBottom: '0.5rem' }}>
                          {item.year}
                        </div>
                        <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                          {item.event}
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                          {item.desc}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '4rem', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
          Join us on the mission
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: '2rem', fontSize: '1.1rem' }}>
          Start using HireFlow today and transform your hiring process
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button style={{
            background: 'var(--accent)',
            color: 'var(--ink)',
            border: 'none',
            padding: '0.75rem 2rem',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '1rem'
          }}>
            Get Started Free
          </button>
          <button style={{
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
            padding: '0.75rem 2rem',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '1rem'
          }}>
            Schedule Demo
          </button>
        </div>
      </div>
    </div>
  )
}
