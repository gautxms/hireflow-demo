export default function AboutPage({ onBack }) {
  const teamMembers = [
    {
      id: 1,
      name: 'Gautam',
      title: 'Founder',
      bio: 'Built HireFlow to help early teams spend less time manually reviewing resumes and more time meeting candidates.',
      expertise: ['Recruiting', 'Product', 'Operations'],
      image: '👔'
    }
  ]

  const values = [
    { icon: '🎯', title: 'User-Centric', description: 'Everything we build starts with real recruiting pain points.' },
    { icon: '📊', title: 'Transparent', description: 'We clearly show what data is extracted and where automation is still in progress.' },
    { icon: '🚀', title: 'Fast', description: 'We focus on reducing manual resume review time for lean teams.' },
    { icon: '🤝', title: 'Trustworthy', description: 'Candidate data privacy and secure handling are core product requirements.' }
  ]

  const timeline = [
    { year: '2024 Q1', event: 'Idea and prototype', desc: 'Initial resume upload + parsing flow built with early user feedback.' },
    { year: '2024 Q3', event: 'Private MVP', desc: 'Started sharing the product with a small group of recruiting teams.' },
    { year: '2025 Q1', event: 'Beta launch', desc: 'Opened beta access and started collecting structured product feedback.' },
    { year: 'Today', event: 'Improving core workflow', desc: 'Focused on parsing quality, candidate review UX, and reliability.' }
  ]

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      <div style={{ borderBottom: '1px solid var(--border)', padding: '2rem 4rem' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back</button>
      </div>

      <div style={{ padding: '6rem 4rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1.5rem', fontFamily: 'var(--font-display)' }}>About HireFlow</h1>
        <p style={{ fontSize: '1.2rem', color: 'var(--muted)', maxWidth: '700px', margin: '0 auto', lineHeight: '1.8' }}>
          HireFlow is an early-stage product focused on making resume review faster and clearer for small recruiting teams.
        </p>
      </div>

      <div style={{ padding: '4rem', maxWidth: '900px', margin: '0 auto', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem', fontFamily: 'var(--font-display)' }}>Our Story</h2>
        <div style={{ display: 'grid', gap: '1.5rem', color: 'var(--muted)', lineHeight: '1.8' }}>
          <p>HireFlow started as a simple response to a real problem: manually reviewing resumes takes too long and slows down good hiring teams.</p>
          <p>We built a focused MVP that helps teams upload resumes, extract key candidate details, and organize that information in one place.</p>
          <p>We're currently in beta and improving the product with direct feedback from early users.</p>
        </div>
      </div>

      <div style={{ padding: '4rem', maxWidth: '1000px', margin: '0 auto', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '3rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>Our Values</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '2rem' }}>
          {values.map((value, i) => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem' }}>
              <div style={{ fontSize: '2.2rem', marginBottom: '0.8rem' }}>{value.icon}</div>
              <h3 style={{ fontWeight: 'bold', marginBottom: '0.75rem' }}>{value.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: '1.6' }}>{value.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '4rem', background: 'var(--ink-2)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>Founder</h2>
          {teamMembers.map(member => (
            <div key={member.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', textAlign: 'center' }}>
              <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>{member.image}</div>
              <h3 style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{member.name}</h3>
              <p style={{ color: 'var(--accent)', marginBottom: '1rem' }}>{member.title}</p>
              <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>{member.bio}</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                {member.expertise.map((skill, i) => <span key={i} style={{ background: 'rgba(232,255,90,0.15)', color: 'var(--accent)', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.8rem' }}>{skill}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '4rem', background: 'var(--ink-2)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>Our Journey</h2>
          <div style={{ display: 'grid', gap: '1rem' }}>
            {timeline.map((item, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1.25rem' }}>
                <div style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{item.year}</div>
                <div style={{ fontWeight: 'bold', marginTop: '0.2rem' }}>{item.event}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.3rem' }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
