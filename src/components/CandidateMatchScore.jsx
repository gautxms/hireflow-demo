function getMatchColor(score) {
  if (score >= 85) return 'var(--accent-2)'
  if (score >= 70) return 'var(--accent)'
  if (score >= 55) return '#f59e0b'
  return '#ef4444'
}

export default function CandidateMatchScore({ matchScore }) {
  if (!matchScore || typeof matchScore.score !== 'number') {
    return null
  }

  const { score, fit, breakdown = {} } = matchScore
  const requiredSkills = breakdown.requiredSkills || {}
  const experience = breakdown.experience || {}
  const roleMatch = breakdown.roleMatch || {}

  const color = getMatchColor(score)
  const matchedSkillsLabel = Array.isArray(requiredSkills.matchedSkills) && requiredSkills.matchedSkills.length > 0
    ? ` (${requiredSkills.matchedSkills.join(', ')})`
    : ''

  return (
    <div style={{
      marginTop: '1rem',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '1rem',
    }}>
      <p style={{ fontSize: '1rem', margin: 0, marginBottom: '0.5rem', color }}>
        📊 Match: <strong>{score}%</strong> ({fit || 'Match'})
      </p>
      <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--muted)', lineHeight: 1.6 }}>
        <li>
          {requiredSkills.matched === requiredSkills.total ? '✓' : '✗'} {requiredSkills.matched ?? 0}/{requiredSkills.total ?? 0} required skills{matchedSkillsLabel}
        </li>
        <li>
          {Number(experience.years ?? 0) >= Number(experience.requiredYears ?? 0) ? '✓' : '✗'} {experience.years ?? 0} years experience (needs {experience.requiredYears ?? 0})
        </li>
        <li>
          {roleMatch.matches ? '✓' : '✗'} "{roleMatch.candidateRole || 'Unknown role'}" role matches{roleMatch.targetRole ? ` ${roleMatch.targetRole}` : ''}
        </li>
      </ul>
    </div>
  )
}
