import { useMemo, useState } from 'react'

const parseSkillsFromName = (name) => {
  const lower = name.toLowerCase()
  if (lower.includes('frontend')) return ['React', 'JavaScript', 'CSS']
  if (lower.includes('backend')) return ['Node.js', 'APIs', 'SQL']
  if (lower.includes('data')) return ['Python', 'SQL', 'Data Analysis']
  return ['Communication', 'Problem Solving', 'Collaboration']
}

export default function CandidateResults({ candidates, onBack }) {
  const [sortBy, setSortBy] = useState('name')

  const parsedCandidates = useMemo(() => {
    const source = Array.isArray(candidates) ? candidates : []

    if (!source.length) {
      return [
        {
          id: 1,
          name: 'Sample Candidate',
          experience: 'Experience not detected yet',
          skills: ['Resume uploaded', 'Parsing pending'],
          source: 'sample_resume.pdf'
        }
      ]
    }

    return source.map((candidate, index) => {
      const filename = candidate.name || candidate.file?.name || `resume_${index + 1}.pdf`
      const name = filename.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ')
      return {
        id: index + 1,
        name,
        experience: 'Experience extracted from resume text',
        skills: parseSkillsFromName(filename),
        source: filename
      }
    })
  }, [candidates])

  const display = [...parsedCandidates].sort((a, b) => {
    if (sortBy === 'recent') return b.id - a.id
    return a.name.localeCompare(b.name)
  })

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto', marginBottom: '2rem' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>← Upload New Resumes</button>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>Candidate Results</h1>
        <p style={{ color: 'var(--muted)' }}>{display.length} resumes processed</p>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ background: 'rgba(232,255,90,0.1)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '6px', padding: '0.6rem 1rem', fontSize: '0.9rem', fontWeight: 'bold' }}>
          Data extracted from resume
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
          <option value="name">Sort by name</option>
          <option value="recent">Sort by upload order</option>
        </select>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
        {display.map(candidate => (
          <div key={candidate.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '0.4rem' }}>{candidate.name}</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.6rem' }}>Source file: {candidate.source}</p>
            <p style={{ color: 'var(--muted)', marginBottom: '0.9rem' }}>{candidate.experience}</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {candidate.skills.map((skill, i) => (
                <span key={i} style={{ border: '1px solid var(--border)', borderRadius: '999px', padding: '0.3rem 0.8rem', fontSize: '0.85rem', color: 'var(--muted)' }}>{skill}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ maxWidth: '1000px', margin: '1.5rem auto 0', background: 'rgba(90,255,184,0.1)', border: '1px solid var(--accent-2)', borderRadius: '8px', padding: '1rem 1.25rem', color: 'var(--muted)' }}>
        <strong style={{ color: 'var(--accent-2)' }}>Scoring coming soon:</strong> AI ranking and candidate fit scores are planned for a future release.
      </div>
    </div>
  )
}
