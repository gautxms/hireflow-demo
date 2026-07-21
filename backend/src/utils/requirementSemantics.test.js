import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRequirementSemantics,
  formatRequirementSemanticsForPrompt,
  reconcileCandidateRequirementSemantics,
} from './requirementSemantics.js'

const jd = () => ({
  requirements: [
    'Required:',
    '- Build REST APIs and work with SQL databases',
    '- Strong proficiency in one of Java, Go, C#, or TypeScript/Node.js',
    'Preferred:',
    '- Kubernetes production ownership',
    '- AI document-processing exposure is a plus',
  ].join('\n'),
  skills: ['REST APIs', 'SQL'],
})

test('separates explicitly required and preferred clauses conservatively', () => {
  const semantics = buildRequirementSemantics(jd())
  assert.ok(semantics.required.includes('Build REST APIs and work with SQL databases'))
  assert.ok(semantics.required.includes('REST APIs'))
  assert.ok(semantics.preferred.includes('Kubernetes production ownership'))
  assert.ok(semantics.preferred.includes('AI document-processing exposure is a plus'))
  assert.equal(semantics.required.some((entry) => /Kubernetes/i.test(entry)), false)
})

test('extracts an explicit any-of language group without making every language cumulative', () => {
  const semantics = buildRequirementSemantics(jd())
  assert.deepEqual(semantics.alternativeGroups, [[
    'Java',
    'Go',
    'C#',
    'TypeScript',
    'Node.js',
  ]])
})

test('unmarked skills remain required when the JD also mentions preferred items', () => {
  const semantics = buildRequirementSemantics({
    requirements: 'Kubernetes is preferred',
    skills: ['PostgreSQL'],
  })
  assert.deepEqual(semantics.required, ['PostgreSQL'])
  assert.deepEqual(semantics.preferred, ['Kubernetes is preferred'])
})

test('an item explicitly entered as a required skill is not downgraded by a preferred sentence', () => {
  const semantics = buildRequirementSemantics({
    requirements: 'Kubernetes experience is preferred',
    skills: ['Kubernetes'],
  })
  assert.deepEqual(semantics.required, ['Kubernetes'])
  assert.deepEqual(semantics.preferred, [])
})

test('prompt contract distinguishes core, preferred, and any-of groups', () => {
  const prompt = formatRequirementSemanticsForPrompt(buildRequirementSemantics(jd()))
  assert.match(prompt, /Required\/core clauses/)
  assert.match(prompt, /Preferred\/bonus clauses/)
  assert.match(prompt, /Java OR Go OR C# OR TypeScript OR Node\.js/)
  assert.match(prompt, /must not be described or scored as mandatory core failures/)
})

test('semantics stay bounded so long uploaded JDs do not duplicate unbounded text into AI prompts', () => {
  const requirements = Array.from({ length: 60 }, (_, index) => `Required capability ${index}: ${'detail '.repeat(100)}`).join('\n')
  const semantics = buildRequirementSemantics({ requirements })
  assert.equal(semantics.required.length, 40)
  assert.ok(semantics.required.every((entry) => entry.length <= 360))
  assert.ok(formatRequirementSemanticsForPrompt(semantics).length < 16000)
})

test('covered alternative removes only false cumulative gaps and moves preferred gaps out of core missing arrays', () => {
  const semantics = buildRequirementSemantics(jd())
  const candidate = {
    matchedSkills: ['Node.js', 'SQL'],
    skills_flat: ['Node.js', 'PostgreSQL'],
    missingSkills: ['Java', 'Go', 'C#', 'Kubernetes'],
    fit_assessment: {
      matched_requirements: ['Node.js', 'REST APIs', 'SQL'],
      missing_requirements: [
        'No Java, Go, or C# mentioned.',
        'Kubernetes production ownership is not documented.',
      ],
    },
  }
  const before = structuredClone(candidate)
  const reconciled = reconcileCandidateRequirementSemantics(candidate, semantics)

  assert.deepEqual(reconciled.missingSkills, [])
  assert.deepEqual(reconciled.fit_assessment.missing_requirements, [])
  assert.deepEqual(reconciled.preferredGaps, ['Kubernetes production ownership is not documented.'])
  assert.deepEqual(reconciled.fit_assessment.preferred_gaps, reconciled.preferredGaps)
  assert.deepEqual(candidate, before)
})

test('alternative gaps remain when the candidate satisfies none of the options', () => {
  const semantics = buildRequirementSemantics(jd())
  const candidate = {
    skills_flat: ['SQL'],
    missingSkills: ['Java', 'Go', 'C#', 'TypeScript', 'Node.js'],
    fit_assessment: {
      matched_requirements: ['SQL'],
      missing_requirements: ['No supported backend language is documented'],
    },
  }
  const reconciled = reconcileCandidateRequirementSemantics(candidate, semantics)
  assert.deepEqual(reconciled.missingSkills, candidate.missingSkills)
  assert.deepEqual(reconciled.fit_assessment.missing_requirements, candidate.fit_assessment.missing_requirements)
})

test('combined text preserves an unrelated required gap while removing the satisfied alternative clause', () => {
  const semantics = buildRequirementSemantics({
    requirements: 'Java, Go, or Node.js\nKubernetes is required',
  })
  const candidate = {
    skills_flat: ['Node.js'],
    missingSkills: ['No Java or Go; Kubernetes production experience is missing'],
    fit_assessment: {
      matched_requirements: ['Node.js'],
      missing_requirements: ['No Java or Go; Kubernetes production experience is missing'],
    },
  }
  const reconciled = reconcileCandidateRequirementSemantics(candidate, semantics)
  assert.deepEqual(reconciled.missingSkills, ['Kubernetes production experience is missing'])
  assert.deepEqual(reconciled.fit_assessment.missing_requirements, ['Kubernetes production experience is missing'])
})

test('AWS/Azure/GCP slash notation is interpreted as an explicit alternative group', () => {
  const semantics = buildRequirementSemantics({ requirements: 'Experience with AWS/Azure/GCP' })
  assert.deepEqual(semantics.alternativeGroups, [['AWS', 'Azure', 'GCP']])
  const reconciled = reconcileCandidateRequirementSemantics({
    skills_flat: ['AWS'],
    missingSkills: ['Azure', 'GCP'],
    fit_assessment: { matched_requirements: ['AWS'], missing_requirements: ['Azure or GCP not documented'] },
  }, semantics)
  assert.deepEqual(reconciled.missingSkills, [])
  assert.deepEqual(reconciled.fit_assessment.missing_requirements, [])
})

test('a covered preferred alternative group does not create a gap for every unselected option', () => {
  const semantics = buildRequirementSemantics({ requirements: 'AWS, Azure, or GCP experience is preferred' })
  const reconciled = reconcileCandidateRequirementSemantics({
    skills_flat: ['AWS'],
    missingSkills: ['Azure', 'GCP'],
    fit_assessment: { missing_requirements: ['Azure or GCP are not documented'] },
  }, semantics)
  assert.deepEqual(reconciled.missingSkills, [])
  assert.deepEqual(reconciled.fit_assessment.missing_requirements, [])
  assert.equal(reconciled.preferredGaps, undefined)
})
