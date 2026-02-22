import { useState } from 'react'

export default function CandidateResults({ candidates, onBack }) {
  const [sortBy, setSortBy] = useState('score') // 'score', 'name', 'fit'
  const [filterTier, setFilterTier] = useState('all') // 'all', 'top', 'strong', 'consider'

  // Mock candidate data if none provided
  const mockCandidates = [
    {
      id: 1,
      name: 'Sarah Chen',
      position: 'Senior Software Engineer',
      score: 94,
      fit: 'Excellent',
      tier: 'top',
      skills: ['React', 'Node.js', 'Python', 'AWS'],
      experience: '8 years',
      education: 'BS Computer Science, Stanford',
      pros: ['Strong technical background', 'Leadership experience', 'Relevant tech stack'],
      cons: ['Seeking management role']
    },
    {
      id: 2,
      name: 'Marcus Rodriguez',
      position: 'Full Stack Developer',
      score: 87,
      fit: 'Strong',
      tier: 'strong',
      skills: ['JavaScript', 'React', 'Node.js', 'MongoDB'],
      experience: '6 years',
      education: 'BS Software Engineering, UT Austin',
      pros: ['Modern stack', 'Startup experience', 'Quick learner'],
      cons: ['Limited DevOps experience']
    },
    {
      id: 3,
      name: 'Priya Sharma',
      position: 'Product Engineer',
      score: 81,
      fit: 'Strong',
      tier: 'strong',
      skills: ['Java', 'React', 'Kubernetes', 'GCP'],
      experience: '5 years',
      education: 'BS IT, Delhi University',
      pros: ['Cloud infrastructure', 'Problem solver', 'Collaborative'],
      cons: ['Less frontend experience']
    },
    {
      id: 4,
      name: 'Alex Hernandez',
      position: 'Backend Engineer',
      score: 76,
      fit: 'Good',
      tier: 'consider',
      skills: ['Go', 'Python', 'PostgreSQL', 'Docker'],
      experience: '4 years',
      education: 'BS Computer Science, UC Berkeley',
      pros: ['Systems design', 'Performance optimization', 'Open source'],
      cons: ['Less full-stack', 'Limited team size exposure']
    },
    {
      id: 5,
      name: 'Julia Martinez',
      position: 'Frontend Developer',
      score: 72,
      fit: 'Consider',
      tier: 'consider',
      skills: ['Vue.js', 'TypeScript', 'CSS', 'Figma'],
      experience: '3 years',
      education: 'Bootcamp (General Assembly)',
      pros: ['Design-minded', 'Strong styling', 'Fast learner'],
      cons: ['Less backend', 'Small company background']
    }
  ]

  const displayCandidates = candidates && candidates.length > 0 ? candidates : mockCandidates

  let filtered = displayCandidates
  if (filterTier !== 'all') {
    filtered = filtered.filter(c => c.tier === filterTier)
  }

  if (sortBy === 'name') {
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  } else if (sortBy === 'fit') {
    const fitOrder = { 'Excellent': 0, 'Strong': 1, 'Good': 2, 'Consider': 3 }
    filtered = [...filtered].sort((a, b) => (fitOrder[a.fit] || 4) - (fitOrder[b.fit] || 4))
  } else {
    filtered = [...filtered].sort((a, b) => b.score - a.score)
  }

  const getScoreColor = (score) => {
    if (score >= 90) return 'var(--accent-2)' // cyan
    if (score >= 80) return 'var(--accent)' // lime
    if (score >= 70) return '#f59e0b' // orange
    return '#ef4444' // red
  }

  const getTierBadge = (tier) => {
    const styles = {
      top: { bg: 'rgba(90,255,184,0.15)', color: 'var(--accent-2)', label: '⭐ TOP' },
      strong: { bg: 'rgba(232,255,90,0.15)', color: 'var(--accent)', label: '✓ STRONG' },
      consider: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: '→ CONSIDER' }
    }
    const style = styles[tier] || styles.consider
    return { bg: style.bg, color: style.color, label: style.label }
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      {/* Header */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem' }}>
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
          ← Upload New Resumes
        </button>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>
          Candidate Ranking
        </h1>
        <p style={{ color: 'var(--muted)' }}>
          {filtered.length} candidates analyzed and ranked by fit
        </p>
      </div>

      {/* Controls */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Sort By</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <option value="score">Score (High to Low)</option>
            <option value="name">Name (A-Z)</option>
            <option value="fit">Fit Quality</option>
          </select>
        </div>

        <div>
          <label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Filter</label>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <option value="all">All Candidates</option>
            <option value="top">Top Tier Only</option>
            <option value="strong">Strong & Above</option>
            <option value="consider">All Including Consider</option>
          </select>
        </div>
      </div>

      {/* Candidates List */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        {filtered.map(candidate => {
          const tier = getTierBadge(candidate.tier)
          return (
            <div
              key={candidate.id}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '2rem',
                transition: 'all 0.3s'
              }}
            >
              {/* Top Section */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2rem', marginBottom: '1.5rem', alignItems: 'start' }}>
                <div>
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                    {candidate.name}
                  </h3>
                  <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>
                    {candidate.position} • {candidate.experience}
                  </p>
                  <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                    {candidate.education}
                  </p>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '100px',
                    height: '100px',
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${getScoreColor(candidate.score)} 0%, transparent 70%)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `3px solid ${getScoreColor(candidate.score)}`
                  }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '2rem', fontWeight: 'bold', color: getScoreColor(candidate.score) }}>
                        {candidate.score}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>score</div>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    background: tier.bg,
                    color: tier.color,
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    fontSize: '0.9rem'
                  }}>
                    {tier.label}
                  </div>
                </div>
              </div>

              {/* Skills */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem' }}>Skills</h4>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {candidate.skills.map((skill, i) => (
                    <span
                      key={i}
                      style={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        padding: '0.4rem 0.8rem',
                        borderRadius: '4px',
                        fontSize: '0.85rem'
                      }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Pros & Cons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div>
                  <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--accent-2)' }}>
                    ✓ Strengths
                  </h4>
                  <ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>
                    {candidate.pros.map((pro, i) => (
                      <li key={i}>{pro}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: '#f59e0b' }}>
                    ⚠ Considerations
                  </h4>
                  <ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>
                    {candidate.cons.map((con, i) => (
                      <li key={i}>{con}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* CTA */}
              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
                <button style={{
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  border: 'none',
                  padding: '0.6rem 1.5rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}>
                  Schedule Interview
                </button>
                <button style={{
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  padding: '0.6rem 1.5rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}>
                  View Full Profile
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
