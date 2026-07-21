// Synthetic, anonymized contracts. These are characterization inputs, not target production scores.
const fixture = (id, score, yearsExperience, requirements = {}) => Object.freeze({
  id,
  score,
  matchScore: Object.freeze({ score }),
  years_experience: yearsExperience,
  requirements: Object.freeze(requirements),
})

export const SCORING_REGRESSION_FIXTURES = Object.freeze({
  excellent: fixture('excellent-match', 91, 7.5),
  strong: fixture('strong-match', 82, 6),
  moderate: fixture('moderate-match', 68, 4),
  low: fixture('clearly-low-match', 31, 1),
  decimalInsideRange: fixture('decimal-inside-range', 76, 4.5, { experience: { min: 3, max: 5 } }),
  lowerBoundary: fixture('lower-boundary', 74, 3, { experience: { min: 3, max: 5 } }),
  upperBoundary: fixture('upper-boundary', 75, 5, { experience: { min: 3, max: 5 } }),
  alternativeTechnology: fixture('alternative-technology', 72, 4, { anyOf: ['technology-a', 'technology-b'] }),
  preferredQualification: fixture('preferred-qualification', 70, 4, { required: ['core-skill'], preferred: ['bonus-skill'] }),
  noEducationRequirement: fixture('no-education-requirement', 73, 4, { education: null }),
})
