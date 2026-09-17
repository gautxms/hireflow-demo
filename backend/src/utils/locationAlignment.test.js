import test from 'node:test'
import assert from 'node:assert/strict'

import {
  evaluateLocationAlignment,
  formatLocationAlignmentForPrompt,
  reconcileCandidateLocationAlignment,
  resolveJobWorkMode,
} from './locationAlignment.js'

test('resolves dedicated and labelled work mode before legacy employment type', () => {
  assert.equal(resolveJobWorkMode({ employmentType: 'Remote', location: 'Austin' }), 'remote')
  assert.equal(resolveJobWorkMode({ workMode: 'Hybrid', location: 'Remote' }), 'hybrid')
  assert.equal(resolveJobWorkMode({
    employmentType: 'On-site',
    description: 'Work mode:\n**Hybrid**',
  }), 'hybrid')
  assert.equal(resolveJobWorkMode({
    workMode: 'Remote',
    employmentType: 'On-site',
    description: 'Work mode: Hybrid',
  }), 'remote')
  assert.equal(resolveJobWorkMode({ employment_type: 'on-site' }), 'on_site')
  assert.equal(resolveJobWorkMode({ location: 'Bengaluru / Remote Hybrid' }), 'hybrid')
  assert.equal(resolveJobWorkMode({ employmentType: 'full-time', location: 'Austin' }), 'unspecified')
  assert.equal(resolveJobWorkMode({
    employmentType: 'full-time',
    description: 'Experience with hybrid cloud infrastructure is preferred.',
  }), 'unspecified')
})

test('listed city matches while flexible off-list city remains unknown', () => {
  const context = { location: 'Bengaluru/Hyderabad/Pune', employmentType: 'Hybrid' }
  assert.deepEqual(evaluateLocationAlignment({ location: 'Bengaluru, India' }, context), {
    classification: 'match',
    score: 95,
    candidate_location_available: true,
    jd_location_available: true,
    work_mode: 'hybrid',
  })
  assert.deepEqual(evaluateLocationAlignment({ location: 'Kochi, India' }, context), {
    classification: 'unknown',
    score: 50,
    candidate_location_available: true,
    jd_location_available: true,
    work_mode: 'hybrid',
  })
})

test('remote evidence is compatible with remote work while onsite mismatch stays explicit', () => {
  const remote = evaluateLocationAlignment(
    { location: 'Remote, India' },
    { location: 'India', workMode: 'Remote' },
  )
  assert.equal(remote.classification, 'remote_compatible')
  assert.equal(remote.score, 80)
  assert.equal(evaluateLocationAlignment(
    { location: 'Kochi, India' },
    { location: 'Bengaluru', workMode: 'On-site' },
  ).classification, 'mismatch')
})

test('United States city and state is compatible with a remote United States role', () => {
  assert.deepEqual(
    evaluateLocationAlignment(
      { location: 'Chicago, IL' },
      { location: 'Remote — United States', workMode: 'Remote' },
    ),
    {
      classification: 'remote_compatible',
      score: 95,
      candidate_location_available: true,
      jd_location_available: true,
      work_mode: 'remote',
    },
  )
})

test('sharing a state token does not make different cities an exact match', () => {
  const result = evaluateLocationAlignment(
    { location: 'Houston, TX' },
    { location: 'Austin, TX', workMode: 'On-site' },
  )
  assert.equal(result.classification, 'mismatch')
  assert.equal(result.score, 25)
})

test('missing candidate or JD location evidence remains neutral', () => {
  assert.equal(evaluateLocationAlignment({}, { location: 'Bengaluru', workMode: 'Hybrid' }).score, 50)
  assert.equal(evaluateLocationAlignment({ location: 'Kochi' }, {}).score, 50)
})

test('unknown flexible alignment removes only definite location-failure clauses', () => {
  const candidate = {
    location: 'Kochi, India',
    considerations: ['Strong Node.js evidence; location mismatch for the Bengaluru hybrid role.'],
    recommendation: 'Proceed based on backend depth. Candidate must relocate because of location.',
    matchScore: { reason: 'Core skills match. Geographic mismatch lowers the score.' },
    fit_assessment: {
      location_match_score: 0,
      missing_requirements: ['Location mismatch; Kubernetes experience is missing.'],
      risks_or_gaps: ['Candidate is based in Kochi; location mismatch for this hybrid role.'],
      rationale: 'The candidate meets the API requirements. Location mismatch is a disqualifier.',
      notes: ['Confirm willingness to relocate.', 'Candidate fails the location requirement.'],
    },
  }
  const before = structuredClone(candidate)
  const reconciled = reconcileCandidateLocationAlignment(candidate, {
    location: 'Bengaluru/Hyderabad/Pune',
    workMode: 'Hybrid',
  })

  assert.deepEqual(candidate, before)
  assert.deepEqual(reconciled.fit_assessment.missing_requirements, ['Kubernetes experience is missing.'])
  assert.deepEqual(reconciled.fit_assessment.risks_or_gaps, [])
  assert.deepEqual(reconciled.fit_assessment.notes, [])
  assert.equal(reconciled.fit_assessment.rationale, 'The candidate meets the API requirements.')
  assert.equal(reconciled.fit_assessment.location_match_score, null)
  assert.equal(reconciled.recommendation, 'Proceed based on backend depth.')
  assert.equal(reconciled.matchScore.reason, 'Core skills match.')
  assert.deepEqual(reconciled.considerations, ['Strong Node.js evidence'])
})

test('explicit onsite mismatch is preserved', () => {
  const candidate = {
    location: 'Kochi',
    fit_assessment: { risks_or_gaps: ['Location mismatch for the Bengaluru onsite role.'] },
  }
  assert.equal(
    reconcileCandidateLocationAlignment(candidate, { location: 'Bengaluru', workMode: 'On-site' }),
    candidate,
  )
})

test('hybrid city match corrects false onsite wording across visible result fields without changing scores', () => {
  const candidate = {
    location: 'Austin, TX',
    score: 60.5,
    strengths: ['Located in Austin, TX, matching the on-site work location requirement.'],
    strengthsFull: ['Located in Austin, TX, matching the onsite work location requirement.'],
    matchedSkills: ['Located in Austin, TX (on-site work mode match).'],
    matchedRequirementsFull: ['Located in Austin, TX (on-site work mode match).'],
    matchScore: {
      score: 60.5,
      reason: 'Strong core experience and an on-site location match.',
      breakdown: { location_alignment: '95/100 - Austin on-site match' },
    },
    fit_assessment: {
      overall_fit_score: 60.5,
      matched_requirements: ['Located in Austin, TX (on-site work mode match).'],
      rationale: 'The candidate meets the on-site Austin requirement. The role is Hybrid, not on-site only.',
    },
  }

  const reconciled = reconcileCandidateLocationAlignment(candidate, {
    location: 'Austin, TX',
    workMode: 'Hybrid',
  })
  const visibleNarrative = JSON.stringify(reconciled)

  assert.doesNotMatch(visibleNarrative, /meets the on[ -]?site|on[ -]?site work mode match/i)
  assert.match(visibleNarrative, /hybrid/i)
  assert.match(reconciled.fit_assessment.rationale, /not on-site only/i)
  assert.equal(reconciled.score, 60.5)
  assert.equal(reconciled.matchScore.score, 60.5)
  assert.equal(reconciled.fit_assessment.overall_fit_score, 60.5)
  assert.match(JSON.stringify(candidate), /on-site/i)
})

test('remote United States compatibility replaces unknown location breakdown without changing fit score', () => {
  const candidate = {
    location: 'Chicago, IL',
    score: 91.3,
    matchScore: {
      score: 91.3,
      reason: 'Strong implementation fit. Location compatibility is unknown for the remote work mode.',
      breakdown: {
        skill_match: 'Strong',
        location_match: 'Location compatibility is unknown for the remote work mode.',
      },
    },
    fit_assessment: {
      overall_fit_score: 91.3,
      location_match_score: 50,
      notes: ['Confirm remote location compatibility during screening.'],
    },
  }

  const reconciled = reconcileCandidateLocationAlignment(candidate, {
    location: 'Remote — United States',
    workMode: 'Remote',
  })

  assert.equal(reconciled.score, 91.3)
  assert.equal(reconciled.matchScore.score, 91.3)
  assert.equal(reconciled.fit_assessment.overall_fit_score, 91.3)
  assert.equal(reconciled.fit_assessment.location_match_score, 95)
  assert.match(reconciled.matchScore.breakdown.location_match, /Compatible/i)
  assert.doesNotMatch(JSON.stringify(reconciled), /compatibility is unknown/i)
})

test('remote United States reconciliation removes orphaned country fragments from requirement arrays', () => {
  const candidate = {
    location: 'Denver, CO',
    matchedSkills: ['United States)', 'SQL'],
    matchedRequirementsFull: ['United States)', 'REST API troubleshooting'],
    fit_assessment: {
      matched_requirements: ['United States)', 'Project planning'],
    },
  }

  const reconciled = reconcileCandidateLocationAlignment(candidate, {
    location: 'United States',
    workMode: 'Remote',
  })

  assert.deepEqual(reconciled.matchedSkills, ['SQL'])
  assert.deepEqual(reconciled.matchedRequirementsFull, ['REST API troubleshooting'])
  assert.deepEqual(reconciled.fit_assessment.matched_requirements, ['Project planning'])
})

test('hybrid off-list candidate removes false onsite penalties from every visible narrative surface', () => {
  const candidate = {
    location: 'Seattle, WA',
    score: 68,
    concerns: [
      'Strong discovery skills.',
      'Geographic mismatch: Seattle vs. Austin on-site requirement; no relocation or remote work flexibility indicated.',
    ],
    considerations: ['Geographic mismatch: based in Seattle; role requires on-site presence in Austin.'],
    missingSkills: ['On-site work location: candidate is in Seattle; role requires Austin.'],
    missingRequirementsFull: ['On-site work location: candidate is in Seattle; role requires Austin on-site presence.'],
    risksOrGapsFull: ['Location mismatch (Seattle vs. Austin on-site requirement); no relocation indication in resume.'],
    recommendationFull: 'Strong SaaS seller. Geographic mismatch (Seattle vs. Austin on-site) reduces fit.',
    matchScore: {
      score: 68,
      reason: 'Strong SaaS seller. Geographic mismatch (Seattle vs. Austin on-site requirement).',
      breakdown: {
        skills_match: 82,
        location_alignment: '0/100 - Seattle, WA vs. Austin, TX on-site requirement',
      },
    },
    fit_assessment: {
      overall_fit_score: 68,
      location_match_score: 0,
      missing_requirements: ['On-site work location: candidate is in Seattle; role requires Austin on-site presence.'],
      risks_or_gaps: ['Geographic mismatch: Seattle vs. Austin on-site requirement; no relocation indication in resume.'],
      notes: [
        'Location barrier is material for on-site Austin role unless relocation is feasible.',
        'Relocation or commute feasibility to Austin not stated.',
      ],
      rationale: 'The candidate meets the sales requirements. Location mismatch (Seattle vs. Austin on-site requirement).',
    },
  }

  const reconciled = reconcileCandidateLocationAlignment(candidate, {
    location: 'Austin, TX',
    workMode: 'Hybrid',
  })
  const visibleNarrative = JSON.stringify(reconciled)

  assert.doesNotMatch(visibleNarrative, /on[ -]?site|location mismatch|geographic mismatch|relocat/i)
  assert.deepEqual(reconciled.concerns, ['Strong discovery skills.'])
  assert.deepEqual(reconciled.matchScore.breakdown, {
    skills_match: 82,
    location_alignment: 'Location compatibility is unknown for the hybrid work mode; confirm attendance and geographic requirements during screening.',
  })
  assert.equal(reconciled.fit_assessment.location_match_score, null)
  assert.equal(reconciled.score, 68)
  assert.equal(reconciled.matchScore.score, 68)
  assert.equal(reconciled.fit_assessment.overall_fit_score, 68)
})

test('hybrid reconciliation leaves internal model diagnostics intact', () => {
  const candidate = {
    location: 'Seattle, WA',
    ai_scoring_contract_v2: {
      model_reported_anomalies: ['location_mismatch_onsite_constraint'],
    },
    fit_assessment: {
      risks_or_gaps: ['Location mismatch for the Austin on-site role.'],
    },
  }

  const reconciled = reconcileCandidateLocationAlignment(candidate, {
    location: 'Austin, TX',
    workMode: 'Hybrid',
  })

  assert.deepEqual(reconciled.ai_scoring_contract_v2.model_reported_anomalies, [
    'location_mismatch_onsite_constraint',
  ])
  assert.deepEqual(reconciled.fit_assessment.risks_or_gaps, [])
})

test('unknown hybrid alignment neutralizes production-shaped location leaks without changing scores', () => {
  const candidate = {
    location: 'Seattle, WA',
    score: 76,
    considerations: [
      'Strong sales fundamentals.',
      'Role located in Austin, TX with hybrid work mode; relocation willingness not provided.',
    ],
    concerns: ['Geographic location is a practical consideration for this hybrid role.'],
    missingSkills: ['Geographic location: Seattle, WA vs. Austin, TX; relocation willingness unknown'],
    missingRequirementsFull: ['Geographic location: Seattle, WA vs. Austin, TX; relocation willingness unknown'],
    risksOrGapsFull: ['Location is also misaligned (Seattle vs. Austin).'],
    recommendationFull: 'Strong SaaS seller. Geographic location (Seattle vs. Austin) is a practical consideration for a hybrid role.',
    matchScore: {
      score: 76,
      score_out_of_ten: 7.6,
      reason: 'Strong SaaS seller with relevant closing experience.',
      breakdown: {
        skill_match: 'Strong',
        location_match: 'Weak — Seattle, WA vs. Austin, TX; relocation unknown',
        geographic_fit: 'Mismatch',
      },
    },
    fit_assessment: {
      overall_fit_score: 76,
      location_match_score: 0,
      missing_requirements: ['Geographic location: Seattle, WA vs. Austin, TX; relocation willingness unknown'],
      risks_or_gaps: ['Location is also misaligned (Seattle vs. Austin).'],
      notes: [
        'Recommend probing relocation/commute feasibility in interview.',
        'Promotion trajectory is strong.',
      ],
      rationale: 'The candidate meets the sales requirements. Geographic location (Seattle vs. Austin) is a practical consideration for a hybrid role.',
    },
  }

  const reconciled = reconcileCandidateLocationAlignment(candidate, {
    location: 'Austin, TX',
    workMode: 'Hybrid',
  })
  const neutral = 'Location compatibility is unknown for the hybrid work mode; confirm attendance and geographic requirements during screening.'

  assert.deepEqual(reconciled.considerations, ['Strong sales fundamentals.'])
  assert.deepEqual(reconciled.concerns, [])
  assert.deepEqual(reconciled.missingSkills, [])
  assert.deepEqual(reconciled.missingRequirementsFull, [])
  assert.deepEqual(reconciled.risksOrGapsFull, [])
  assert.equal(reconciled.recommendationFull, 'Strong SaaS seller.')
  assert.deepEqual(reconciled.matchScore.breakdown, {
    skill_match: 'Strong',
    location_match: neutral,
    geographic_fit: neutral,
  })
  assert.deepEqual(reconciled.fit_assessment.missing_requirements, [])
  assert.deepEqual(reconciled.fit_assessment.risks_or_gaps, [])
  assert.deepEqual(reconciled.fit_assessment.notes, ['Promotion trajectory is strong.'])
  assert.equal(reconciled.fit_assessment.rationale, 'The candidate meets the sales requirements.')
  assert.equal(reconciled.fit_assessment.location_match_score, null)
  assert.equal(reconciled.score, 76)
  assert.equal(reconciled.matchScore.score, 76)
  assert.equal(reconciled.matchScore.score_out_of_ten, 7.6)
  assert.equal(reconciled.fit_assessment.overall_fit_score, 76)
})

test('unknown hybrid alignment removes unsupported distance estimates while preserving hybrid-cloud skills', () => {
  const candidate = {
    location: 'San Antonio, TX',
    considerations: [
      'Location is 45 miles from Austin; hybrid work mode not explicitly confirmed.',
      'Designed hybrid cloud infrastructure for enterprise customers.',
    ],
    matchScore: {
      breakdown: {
        location_fit: 'San Antonio vs. Austin; hybrid compatibility unknown (45%)',
      },
    },
  }

  const reconciled = reconcileCandidateLocationAlignment(candidate, {
    location: 'Austin, TX',
    workMode: 'Hybrid',
  })

  assert.deepEqual(reconciled.considerations, [
    'Designed hybrid cloud infrastructure for enterprise customers.',
  ])
  assert.doesNotMatch(reconciled.matchScore.breakdown.location_fit, /45\s*(?:miles|%)/i)
  assert.match(reconciled.matchScore.breakdown.location_fit, /compatibility is unknown/i)
})

test('prompt semantics describe unknown flexible compatibility without inventing relocation intent', () => {
  const prompt = formatLocationAlignmentForPrompt({ workMode: 'Hybrid' })
  assert.match(prompt, /Work mode: hybrid/)
  assert.match(prompt, /off-list candidate location is unknown/i)
  assert.match(prompt, /Do not infer willingness to relocate/i)
  assert.match(prompt, /remote role scoped to the United States/i)
})
