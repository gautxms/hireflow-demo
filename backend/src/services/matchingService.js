function parseYears(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)

  const match = String(value).match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function normalizeSkills(skills) {
  if (Array.isArray(skills)) {
    return skills.map((skill) => String(skill).trim()).filter(Boolean)
  }

  return String(skills || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)
}

function toSkillSet(skills) {
  return new Set(normalizeSkills(skills).map((skill) => skill.toLowerCase()))
}

function normalizeJobDescription(jobDescription = {}) {
  return {
    id: jobDescription.id || jobDescription.jobDescriptionId || null,
    title: String(jobDescription.title || jobDescription.role || jobDescription.position || '').trim(),
    requiredSkills: normalizeSkills(jobDescription.requiredSkills || jobDescription.skills || []),
    minimumExperienceYears: parseYears(jobDescription.minimumExperienceYears || jobDescription.requiredExperienceYears || jobDescription.minYears),
  }
}

function getRoleMatchScore(candidatePosition, targetRole) {
  const normalizedCandidateRole = String(candidatePosition || '').toLowerCase().trim()
  const normalizedTargetRole = String(targetRole || '').toLowerCase().trim()

  if (!normalizedTargetRole) {
    return { score: 100, matches: true }
  }

  if (!normalizedCandidateRole) {
    return { score: 0, matches: false }
  }

  if (normalizedCandidateRole === normalizedTargetRole) {
    return { score: 100, matches: true }
  }

  if (normalizedCandidateRole.includes(normalizedTargetRole) || normalizedTargetRole.includes(normalizedCandidateRole)) {
    return { score: 85, matches: true }
  }

  const candidateTokens = normalizedCandidateRole.split(/\s+/)
  const targetTokens = normalizedTargetRole.split(/\s+/)
  const overlap = targetTokens.filter((token) => candidateTokens.includes(token)).length
  const overlapScore = targetTokens.length > 0 ? Math.round((overlap / targetTokens.length) * 100) : 0

  return { score: overlapScore, matches: overlap > 0 }
}

function getFitLabel(score) {
  if (score >= 85) return 'Excellent fit'
  if (score >= 70) return 'Good fit'
  if (score >= 55) return 'Potential fit'
  return 'Low fit'
}

export function calculateCandidateMatchScore(candidate, jobDescription) {
  const normalizedJob = normalizeJobDescription(jobDescription)
  const candidateSkills = normalizeSkills(candidate.skills)
  const candidateSkillSet = toSkillSet(candidateSkills)
  const requiredSkills = normalizedJob.requiredSkills
  const requiredSkillSet = toSkillSet(requiredSkills)

  const matchedRequiredSkills = requiredSkills.filter((skill) => candidateSkillSet.has(String(skill).toLowerCase()))
  const requiredSkillsRatio = requiredSkills.length > 0
    ? matchedRequiredSkills.length / requiredSkills.length
    : 1

  const overlapDenominator = new Set([...requiredSkillSet, ...candidateSkillSet]).size
  const skillOverlapRatio = overlapDenominator > 0
    ? matchedRequiredSkills.length / overlapDenominator
    : 1

  const experienceYears = parseYears(candidate.experienceYears ?? candidate.experience)
  const requiredYears = normalizedJob.minimumExperienceYears
  const experienceRatio = requiredYears > 0
    ? Math.min(experienceYears / requiredYears, 1)
    : 1

  const roleMatch = getRoleMatchScore(candidate.position || candidate.role || candidate.title, normalizedJob.title)

  const skillsScore = Math.round((requiredSkillsRatio * 0.65 + skillOverlapRatio * 0.35) * 100)
  const experienceScore = Math.round(experienceRatio * 100)
  const roleScore = Math.round(roleMatch.score)

  const weightedScore = Math.round(skillsScore * 0.4 + experienceScore * 0.3 + roleScore * 0.3)

  return {
    score: weightedScore,
    fit: getFitLabel(weightedScore),
    breakdown: {
      requiredSkills: {
        matched: matchedRequiredSkills.length,
        total: requiredSkills.length,
        matchedSkills: matchedRequiredSkills,
        requiredSkills,
        ratio: Math.round(requiredSkillsRatio * 100),
      },
      skillOverlap: {
        count: matchedRequiredSkills.length,
        ratio: Math.round(skillOverlapRatio * 100),
      },
      experience: {
        years: experienceYears,
        requiredYears,
        ratio: Math.round(experienceRatio * 100),
      },
      roleMatch: {
        targetRole: normalizedJob.title,
        candidateRole: candidate.position || candidate.role || candidate.title || '',
        ratio: roleScore,
        matches: roleMatch.matches,
      },
    },
    weights: {
      skills: 40,
      experience: 30,
      roleMatch: 30,
    },
  }
}

export function matchCandidatesToJob({ candidates = [], jobDescription = {} }) {
  const normalizedJob = normalizeJobDescription(jobDescription)

  return {
    jobDescription: normalizedJob,
    candidates: (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
      ...candidate,
      matchScore: calculateCandidateMatchScore(candidate, normalizedJob),
    })),
  }
}

export default {
  calculateCandidateMatchScore,
  matchCandidatesToJob,
}
