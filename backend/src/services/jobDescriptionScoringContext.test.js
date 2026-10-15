import test from 'node:test'
import assert from 'node:assert/strict'

import {
  JOB_DESCRIPTION_SCORING_CONTEXT_VERSION,
  buildCanonicalJobDescriptionScoringContext,
} from './jobDescriptionScoringContext.js'

test('canonical scoring context removes creation-path metadata and normalizes equivalent jobs', () => {
  const manual = buildCanonicalJobDescriptionScoringContext({
    hasContext: true,
    jobDescriptionId: 'manual-job-id',
    source: 'manual_fields',
    title: ' Growth Marketing Manager ',
    description: 'Own pipeline growth.\r\nPartner with Sales.',
    requirements: '5+ years\r\n• B2B SaaS',
    responsibilities: 'Build demand-generation programs',
    additionalInfo: 'HubSpot preferred',
    skills: ['SEO', 'HubSpot', 'seo'],
    experienceMin: 5,
    experienceMax: 8,
    location: ' Remote ',
    employmentType: 'Remote',
  })

  const uploaded = buildCanonicalJobDescriptionScoringContext({
    hasContext: true,
    jobDescriptionId: 'uploaded-job-id',
    source: 'manual_fields_file_fallback',
    fileUrl: '/api/job-descriptions/files/private.docx',
    fileText: 'Raw attachment text must not enter scoring.',
    title: 'Growth Marketing Manager',
    description: 'Own pipeline growth.\nPartner with Sales.',
    requirements: '5+ years\n- B2B SaaS',
    responsibilities: 'Build demand-generation programs',
    additional_info: 'HubSpot preferred',
    skills: ['HubSpot', 'seo', 'SEO'],
    experience_min: 5,
    experience_max: 8,
    location: 'Remote',
    work_mode: 'remote',
  })

  assert.deepEqual(uploaded, manual)
  assert.equal(manual.scoringContextVersion, JOB_DESCRIPTION_SCORING_CONTEXT_VERSION)
  assert.match(manual.scoringContextFingerprint, /^[a-f0-9]{64}$/)
  assert.equal('jobDescriptionId' in manual, false)
  assert.equal('source' in manual, false)
  assert.equal('fileUrl' in manual, false)
  assert.equal('fileText' in manual, false)
})

test('canonical scoring fingerprint changes when score-bearing job content changes', () => {
  const base = buildCanonicalJobDescriptionScoringContext({
    hasContext: true,
    title: 'Backend Engineer',
    requirements: 'Node.js',
    experienceMin: 3,
    experienceMax: 5,
  })
  const changed = buildCanonicalJobDescriptionScoringContext({
    hasContext: true,
    title: 'Backend Engineer',
    requirements: 'Node.js and PostgreSQL',
    experienceMin: 3,
    experienceMax: 5,
  })

  assert.notEqual(base.scoringContextFingerprint, changed.scoringContextFingerprint)
})

test('missing job context remains a safe no-JD scoring context', () => {
  assert.deepEqual(buildCanonicalJobDescriptionScoringContext(null), {
    hasContext: false,
    missingReason: 'job_description_missing',
    scoringContextVersion: JOB_DESCRIPTION_SCORING_CONTEXT_VERSION,
    scoringContextFingerprint: null,
  })
})
