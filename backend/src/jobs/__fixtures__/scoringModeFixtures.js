export const SCORING_MODE_FIXTURES = Object.freeze({
  withJobDescriptionContext: {
    candidates: [{
      id: 'cand-ctx-1',
      matchScore: { score: 91, reason: 'Excellent role alignment' },
      fit_assessment: {
        has_job_description_context: true,
        overall_fit_score: 91,
        skill_match_score: 92,
        notes: ['existing_note'],
      },
    }],
    jobDescriptionContext: {
      hasContext: true,
      jobDescriptionId: 'jd-1',
      source: 'manual',
    },
  },
  missingJobDescriptionContext: {
    candidates: [{
      id: 'cand-no-jd-1',
      matchScore: { score: 84, reason: 'Reason that should be hidden without JD' },
      fit_assessment: {
        notes: ['existing_note'],
        overall_fit_score: 84,
        skill_match_score: 76,
        experience_match_score: 88,
      },
    }],
    jobDescriptionContext: {
      hasContext: false,
      source: 'none',
      missingReason: 'job_description_missing',
    },
  },
})
