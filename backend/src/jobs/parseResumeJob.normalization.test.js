import test, { after } from 'node:test'
import assert from 'node:assert/strict'

import { __testables } from './parseResumeJob.js'
import { pool } from '../db/client.js'
import { parseQueue } from '../services/jobQueue.js'


after(async () => {
  await parseQueue.close().catch(() => {})
})

const { buildNormalizedCandidates, isLegacyWordDocument } = __testables



test('legacy Word detection rejects DOC extension, application/msword MIME, and OLE magic', () => {
  const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])

  assert.equal(isLegacyWordDocument({ filename: 'resume.docx', mimeType: 'application/msword' }), true)
  assert.equal(isLegacyWordDocument({ filename: 'resume.doc', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), true)
  assert.equal(isLegacyWordDocument({ filename: 'resume', mimeType: 'application/msword' }), true)
  assert.equal(isLegacyWordDocument({ filename: 'resume.DOC', mimeType: 'application/octet-stream' }), true)
  assert.equal(isLegacyWordDocument({ filename: 'resume.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), false)
  assert.equal(isLegacyWordDocument({ filename: 'resume.pdf', mimeType: 'application/pdf' }), false)
  assert.equal(isLegacyWordDocument({ filename: 'resume.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileBuffer: oleHeader }), true)
})

test('buildNormalizedCandidates preserves fractional/integer/null years_experience values', () => {
  const [fractional] = buildNormalizedCandidates({ candidates: [{ years_experience: 3.5 }] }, { resumeId: 'r1', filename: 'a.pdf' })
  const [integer] = buildNormalizedCandidates({ candidates: [{ years_experience: 3 }] }, { resumeId: 'r2', filename: 'b.pdf' })
  const [missing] = buildNormalizedCandidates({ candidates: [{ years_experience: null }] }, { resumeId: 'r3', filename: 'c.pdf' })

  assert.equal(fractional.years_experience, 3.5)
  assert.equal(integer.years_experience, 3)
  assert.equal(missing.years_experience, null)
})

test('buildNormalizedCandidates preserves structured candidate contract fields', () => {
  const fixtureCandidate = {
    name: 'Rahul B. Yadav',
    email: 'rahul@example.com',
    phone: null,
    location: 'Mumbai',
    summary: 'Senior Business Analyst with 15 years of IT experience.',
    years_experience: 15,
    profile_score: 80,
    seniority_level: 'Senior',
    tags: ['Capital Markets', 'Business Analysis', 'Derivatives'],
    top_skills: ['Agile', 'Scrum', 'Capital Markets', 'Derivatives', 'Fixed Income'],
    skills: {
      tools_and_platforms: ['Jira', 'Confluence', 'SQL'],
      methodologies: ['Agile', 'Scrum', 'Waterfall', 'Kanban'],
      domain_expertise: ['Capital Markets', 'Derivatives', 'Fixed Income', 'EMIR'],
      soft_skills: ['Stakeholder Management', 'Communication'],
    },
    strengths: ['15 years of IT experience in business analysis'],
    considerations: ['Clarify recent hands-on ownership of delivery outcomes'],
    concerns: ['Power BI is not explicitly mentioned in the resume'],
    education: [{ degree: 'MBA', school: 'Example University', graduation_year: 2010 }],
    experience: [{ title: 'Senior Business Analyst', company: 'Example Corp', duration: '2010-2025', startDate: '2010-01', endDate: '2025-01' }],
    certifications: ['CSM'],
    languages: ['English'],
    projects: [{ name: 'Trading platform migration', description: 'Capital markets migration project', url: null }],
    achievements: ['Led requirements for derivatives platform'],
    fit_assessment: {
      has_job_description_context: true,
      overall_fit_score: 82,
      skill_match_score: 80,
      experience_match_score: 90,
      education_match_score: 70,
      location_match_score: 70,
      matched_requirements: ['Business analysis', 'Capital Markets'],
      missing_requirements: ['Power BI'],
      risks_or_gaps: ['Power BI is not explicitly mentioned in the resume'],
      rationale: 'Strong match based on BA and capital markets experience.',
      notes: [],
    },
    matchScore: {
      score: 82,
      score_out_of_ten: 8.2,
      fit: 'Strong match',
      reason: 'Strong capital markets BA profile with 15 years of experience.',
      breakdown: {},
    },
    confidence: {
      name: 1,
      email: 0.8,
      phone: 0.2,
      location: 0.8,
      summary: 0.9,
      skills: 0.9,
      experience: 0.9,
      education: 0.7,
      fit_assessment: 0.8,
    },
  }

  const [candidate] = buildNormalizedCandidates({ candidates: [fixtureCandidate] }, { resumeId: 'resume-1', filename: 'rahul.pdf' })

  assert.equal(candidate.years_experience, 15)
  assert.equal(candidate.profile_score, 80)
  assert.equal(candidate.seniority_level, 'Senior')
  assert.deepEqual(candidate.tags, fixtureCandidate.tags)
  assert.deepEqual(candidate.top_skills, fixtureCandidate.top_skills)

  assert.deepEqual(candidate.skills, fixtureCandidate.skills)
  assert.equal(Object.keys(candidate.skills).length, 4)
  assert.deepEqual(candidate.skills.methodologies, ['Agile', 'Scrum', 'Waterfall', 'Kanban'])
  assert.deepEqual(candidate.skills.domain_expertise, ['Capital Markets', 'Derivatives', 'Fixed Income', 'EMIR'])
  assert.deepEqual(candidate.skills.soft_skills, ['Stakeholder Management', 'Communication'])
  assert.deepEqual(candidate.skills.tools_and_platforms, ['Jira', 'Confluence', 'SQL'])
  assert.equal(candidate.skills.tools_and_platforms.includes('Power BI'), false)

  assert.deepEqual(candidate.fit_assessment, fixtureCandidate.fit_assessment)
  assert.deepEqual(candidate.matchScore, fixtureCandidate.matchScore)
  assert.deepEqual(candidate.confidenceScores, fixtureCandidate.confidence)

  assert.deepEqual(candidate.considerations, fixtureCandidate.considerations)
  assert.deepEqual(candidate.concerns, fixtureCandidate.concerns)

  assert.deepEqual(candidate.education, ['MBA, Example University (2010)'])
  assert.deepEqual(candidate.experience, ['Senior Business Analyst at Example Corp — 2010-2025'])
  assert.deepEqual(candidate.certifications, fixtureCandidate.certifications)
  assert.deepEqual(candidate.languages, fixtureCandidate.languages)
  assert.deepEqual(candidate.projects, ['Trading platform migration — Capital markets migration project'])
  assert.deepEqual(candidate.achievements, fixtureCandidate.achievements)
})


test('buildNormalizedCandidates summarizes object arrays and filters object placeholders', () => {
  const [candidate] = buildNormalizedCandidates({
    candidates: [{
      education: [{ degree: 'BSc', institution: 'State University', year: '2018' }, '[object Object]'],
      experience: [{ title: 'Engineer', company: 'Acme', duration: '2019-2024', highlights: 'Owned platform APIs.' }, '[object Object]'],
      projects: [{ name: 'Hiring Portal', description: 'Built ranking dashboard', technologies: ['React', 'Postgres'] }, '[object Object]'],
    }],
  }, { resumeId: 'resume-structured', filename: 'structured.pdf' })

  assert.deepEqual(candidate.education, ['BSc, State University (2018)'])
  assert.deepEqual(candidate.experience, ['Engineer at Acme — 2019-2024: Owned platform APIs.'])
  assert.deepEqual(candidate.projects, ['Hiring Portal — Built ranking dashboard — Technologies: React, Postgres'])
})

test('isAnalysisActiveForJob treats missing analysis as inactive', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    assert.match(sql, /FROM analyses/)
    assert.deepEqual(params, ['analysis-missing', 7])
    return { rows: [] }
  })

  const result = await __testables.isAnalysisActiveForJob({ analysisId: 'analysis-missing', userId: 7 })

  assert.deepEqual(result, { active: false, reason: 'analysis_missing' })
})

test('isAnalysisActiveForJob treats cancelled and canceled analyses as inactive', async (t) => {
  const statuses = ['cancelled', 'canceled']
  let callIndex = 0
  t.mock.method(pool, 'query', async () => ({ rows: [{ id: 'analysis-1', status: statuses[callIndex++] }] }))

  for (const status of statuses) {
    const result = await __testables.isAnalysisActiveForJob({ analysisId: 'analysis-1', userId: 7 })

    assert.equal(result.active, false)
    assert.equal(result.reason, `analysis_${status}`)
  }
})

test('runParse cancels before AI when parent analysis no longer exists', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })

    if (sql.includes('FROM analyses')) {
      return { rows: [] }
    }

    if (sql.includes('FROM job_descriptions')) {
      return { rows: [] }
    }

    return { rows: [], rowCount: 1 }
  })

  const progressValues = []
  const job = {
    id: 'parse-job-cancelled',
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: {
      resumeId: 'resume-1',
      userId: 7,
      analysisId: 'deleted-analysis',
      filename: 'resume.txt',
      mimeType: 'text/plain',
      fileSize: 12,
      fileBufferBase64: Buffer.from('resume text').toString('base64'),
      jobDescriptionId: null,
    },
    async progress(value) {
      if (typeof value === 'number') progressValues.push(value)
      return progressValues.at(-1) || 0
    },
  }

  const result = await __testables.runParse(job)

  assert.equal(result.cancelled, true)
  assert.equal(result.reason, 'analysis_missing:before_ai')
  assert.equal(progressValues.at(-1), 100)
  assert.equal(queries.some(({ sql }) => sql.includes('analyzeResumeWithConfiguredFallback')), false)
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO resume_analysis_token_usage')), false)
  assert.equal(queries.some(({ sql }) => sql.includes('UPDATE resumes')), false)
  assert.equal(queries.some(({ sql }) => sql.includes("status = 'complete'")), false)
  assert.equal(
    queries.some(({ sql, params }) => sql.includes('UPDATE parse_jobs') && params.includes('cancelled')),
    true,
  )
})

test('docx_empty_extraction failure does not create Anthropic token usage telemetry', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [], rowCount: 1 }
  })

  const error = new Error('docx_empty_extraction::Unable to extract readable text from DOCX file resume.docx')
  error.extractionCategory = 'docx_empty_extraction'

  const result = await __testables.persistAiFailureTokenUsage({
    error,
    resumeId: 'resume-docx-empty',
    parseJobId: 'parse-job-docx-empty',
    userId: 7,
    jobDescriptionId: null,
    filename: 'resume.docx',
    jobDescriptionContext: { hasContext: false, source: 'none' },
  })

  assert.deepEqual(result, { persisted: 0, reason: 'pre_provider_local_extraction_failure' })
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO resume_analysis_token_usage')), false)
  assert.equal(queries.some(({ params }) => params?.includes('anthropic')), false)
})

test('real Anthropic provider failure still creates Anthropic token usage telemetry', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [], rowCount: 1 }
  })

  const error = new Error('provider_timeout::Anthropic request timed out')
  error.attempts = [{
    success: false,
    provider: 'anthropic-primary',
    model: 'claude-sonnet-4-5',
    credentialLabel: 'primary',
    providerSource: 'admin_settings',
    failureCategory: 'provider_timeout',
    failureReason: 'request timed out',
    tokenUsage: {
      usageAvailable: false,
      unavailableReason: 'provider_request_failed:provider_timeout:request timed out',
    },
  }]

  const result = await __testables.persistAiFailureTokenUsage({
    error,
    resumeId: 'resume-anthropic-failure',
    parseJobId: 'parse-job-anthropic-failure',
    userId: 7,
    jobDescriptionId: null,
    filename: 'resume.pdf',
    jobDescriptionContext: { hasContext: false, source: 'none' },
  })

  const inserts = queries.filter(({ sql }) => sql.includes('INSERT INTO resume_analysis_token_usage'))
  assert.deepEqual(result, { persisted: 1, reason: 'provider_attempts' })
  assert.equal(inserts.length, 1)
  assert.equal(inserts[0].params[4], 'anthropic-primary')
  assert.equal(inserts[0].params[6], false)
  assert.equal(inserts[0].params[7], 'provider_request_failed:provider_timeout:request timed out')
})

test('successful Anthropic and OpenAI usage telemetry persists token counts and costs', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [], rowCount: 1 }
  })

  await __testables.persistAiSuccessTokenUsage({
    aiResponse: {
      attempts: [
        {
          success: true,
          provider: 'anthropic-primary',
          model: 'claude-sonnet-4-5',
          credentialLabel: 'primary',
          providerSource: 'admin_settings',
          tokenUsage: {
            usageAvailable: true,
            inputTokens: 1200,
            outputTokens: 300,
            totalTokens: 1500,
            estimatedCostUsd: 0.0045,
          },
        },
        {
          success: true,
          provider: 'openai-fallback',
          model: 'gpt-4.1-mini',
          credentialLabel: 'fallback',
          providerSource: 'admin_settings',
          tokenUsage: {
            usageAvailable: true,
            inputTokens: 1000,
            outputTokens: 250,
            totalTokens: 1250,
            estimatedCostUsd: 0.0012,
          },
        },
      ],
    },
    resumeId: 'resume-success',
    parseJobId: 'parse-job-success',
    userId: 7,
    jobDescriptionId: null,
    filename: 'resume.pdf',
    jobDescriptionContext: { hasContext: true, source: 'manual' },
  })

  const inserts = queries.filter(({ sql }) => sql.includes('INSERT INTO resume_analysis_token_usage'))
  assert.equal(inserts.length, 2)
  assert.deepEqual(inserts.map(({ params }) => params[4]), ['anthropic-primary', 'openai-fallback'])
  assert.deepEqual(inserts.map(({ params }) => params[6]), [true, true])
  assert.deepEqual(inserts.map(({ params }) => params[10]), [1500, 1250])
  assert.deepEqual(inserts.map(({ params }) => params[11]), [0.0045, 0.0012])
})
