import { resolveCandidateScoreState } from './candidateResultsState'

export default function CandidateMatchScore({ matchScore }) {
  if (!matchScore || typeof matchScore.score !== 'number') {
    return null
  }

  const { score, fit, breakdown = {} } = matchScore
  const requiredSkills = breakdown.requiredSkills || {}
  const experience = breakdown.experience || {}
  const roleMatch = breakdown.roleMatch || {}

  const scoreState = resolveCandidateScoreState(score)
  const matchedSkillsLabel = Array.isArray(requiredSkills.matchedSkills) && requiredSkills.matchedSkills.length > 0
    ? ` (${requiredSkills.matchedSkills.join(', ')})`
    : ''

  return (
    <div className={`mt-4 rounded-[var(--radius-lg)] border p-4 ${scoreState.surfaceClass}`}>
      <p className={`mb-2 text-base ${scoreState.accentText}`}>
        📊 Match: <strong>{score}%</strong> ({fit || scoreState.label})
      </p>
      <ul className="m-0 list-disc pl-5 leading-relaxed text-[var(--color-text-secondary)]">
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
