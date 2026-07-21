import test from 'node:test'
import assert from 'node:assert/strict'

import {
  evaluateLocationAlignment,
  formatLocationAlignmentForPrompt,
  reconcileCandidateLocationAlignment,
  resolveJobWorkMode,
} from './locationAlignment.js'

test('resolves explicit work mode before location text and normalizes supported values', () => {
  assert.equal(resolveJobWorkMode({ employmentType: 'Remote', location: 'Austin' }), 'remote')
  assert.equal(resolveJobWorkMode({ workMode: 'Hybrid', location: 'Remote' }), 'hybrid')
  assert.equal(resolveJobWorkMode({ employment_type: 'on-site' }), 'on_site')
  assert.equal(resolveJobWorkMode({ location: 'Bengaluru / Remote Hybrid' }), 'hybrid')
  assert.equal(resolveJobWorkMode({ employmentType: 'full-time', location: 'Austin' }), 'unspecified')
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
  assert.deepEqual(reconciled.fit_assessment.risks_or_gaps, ['Candidate is based in Kochi'])
  assert.deepEqual(reconciled.fit_assessment.notes, ['Confirm willingness to relocate.'])
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

test('prompt semantics describe unknown flexible compatibility without inventing relocation intent', () => {
  const prompt = formatLocationAlignmentForPrompt({ workMode: 'Hybrid' })
  assert.match(prompt, /Work mode: hybrid/)
  assert.match(prompt, /off-list candidate location is unknown/i)
  assert.match(prompt, /Do not infer willingness to relocate/i)
})
