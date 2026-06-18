import { Buffer } from 'node:buffer'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

import {
  __resetParseResumeJobTestOverrides,
  __setParseResumeJobTestOverrides,
  __testables,
  applyJobDescriptionScoringMode,
} from './parseResumeJob.js'
import { __resetMammothClientForTests, __setMammothClientForTests } from '../services/resumeDocumentExtractionService.js'
import { buildPdfJsTextContentMockFromFixtures, buildSyntheticPdfResumeFixture } from '../services/resumeFormatDiagnosticFixtures.js'
import { __resetPdfJsClientForTests, __setPdfJsClientForTests } from '../services/pdfCanonicalExtractionService.js'
import { pool } from '../db/client.js'
import { parseQueue } from '../services/jobQueue.js'


after(async () => {
  await parseQueue.close().catch(() => {})
})

const { buildNormalizedCandidates, isLegacyWordDocument } = __testables


function withPdfObserveOnlyEnv(overrides = {}) {
  const keys = [
    'PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED',
    'PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE',
    'PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS',
    'PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_ANALYSIS_IDS',
    'PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED',
    'PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS',
    'PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_ANALYSIS_IDS',
  ]
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value
  }
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    __resetPdfJsClientForTests()
  }
}


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

test('legacy .doc failure does not create Anthropic or OpenAI token usage telemetry', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [], rowCount: 1 }
  })

  const error = new Error('legacy_word_format::Legacy Word .doc files are not supported for resume.doc')
  error.category = 'legacy_word_format'

  const result = await __testables.persistAiFailureTokenUsage({
    error,
    resumeId: 'resume-legacy-doc',
    parseJobId: 'parse-job-legacy-doc',
    userId: 7,
    jobDescriptionId: null,
    filename: 'resume.doc',
    jobDescriptionContext: { hasContext: false, source: 'none' },
  })

  assert.deepEqual(result, { persisted: 0, reason: 'pre_provider_local_extraction_failure' })
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO resume_analysis_token_usage')), false)
  assert.equal(queries.some(({ params }) => params?.includes('anthropic') || params?.includes('openai')), false)
})

test('local validation and unsupported format failures do not default to Anthropic telemetry', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [], rowCount: 1 }
  })

  for (const error of [
    new Error('unsupported file format: image/png'),
    new Error('local payload validation failed: missing fileBufferBase64'),
  ]) {
    const result = await __testables.persistAiFailureTokenUsage({
      error,
      resumeId: 'resume-local-validation',
      parseJobId: 'parse-job-local-validation',
      userId: 7,
      jobDescriptionId: null,
      filename: 'resume.png',
      jobDescriptionContext: { hasContext: false, source: 'none' },
    })

    assert.deepEqual(result, { persisted: 0, reason: 'pre_provider_local_extraction_failure' })
  }

  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO resume_analysis_token_usage')), false)
  assert.equal(queries.some(({ params }) => params?.includes('anthropic') || params?.includes('openai')), false)
})

test('failure attempts without provider metadata do not default to Anthropic telemetry', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [], rowCount: 1 }
  })

  const error = new Error('docx_empty_extraction::Unable to extract readable text from DOCX file resume.docx')
  error.attempts = [{ success: false, failureCategory: 'docx_empty_extraction' }]

  const result = await __testables.persistAiFailureTokenUsage({
    error,
    resumeId: 'resume-attempt-without-provider',
    parseJobId: 'parse-job-attempt-without-provider',
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

test('parse job failure handler discards deterministic local extraction errors', async (t) => {
  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [], rowCount: 1 }
  })

  const discarded = []
  const cached = []
  const job = {
    id: 'parse-job-docx-empty-failure',
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: {
      resumeId: 'resume-docx-empty-failure',
      userId: 7,
      jobDescriptionId: null,
      fileBufferBase64: Buffer.from('bad docx').toString('base64'),
    },
    progress() {
      return 25
    },
    discard() {
      discarded.push(true)
    },
  }
  const error = new Error('docx_empty_extraction::Unable to extract readable text from DOCX file resume.docx')
  error.extractionCategory = 'docx_empty_extraction'

  const result = await __testables.handleParseJobFailure(job, error, {
    cacheFailureResult: async (jobId, payload) => cached.push({ jobId, payload }),
    logger: { warn() {} },
  })

  assert.equal(result.isNonRetriableFailure, true)
  assert.equal(result.isTerminalFailure, true)
  assert.equal(result.failurePayload.retryable, false)
  assert.equal(result.failurePayload.retryClassification, 'deterministic_local_failure:docx_empty_extraction')
  assert.deepEqual(discarded, [true])
  assert.equal(cached.length, 1)
  assert.equal(cached[0].payload.status, 'failed')
  assert.equal(
    queries.some(({ sql, params }) => sql.includes('UPDATE resumes') && params.includes('resume-docx-empty-failure')),
    true,
  )
  assert.equal(
    queries.some(({ sql, params }) => sql.includes('UPDATE parse_jobs') && params.includes('failed')),
    true,
  )
})


test('enabled legacy DOC local extraction failure stops before AI and token telemetry', async (t) => {
  const previousFlag = process.env.ENABLE_LEGACY_DOC_EXTRACTION
  process.env.ENABLE_LEGACY_DOC_EXTRACTION = 'true'
  const corruptOleLikeDocBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x01])
  const queries = []
  const aiCalls = []
  const discarded = []
  const cached = []

  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    return { rows: [], rowCount: 1 }
  })
  __setParseResumeJobTestOverrides({
    analyzeResumeWithConfiguredFallback: async (...args) => {
      aiCalls.push(args)
      throw new Error('analyzeResumeWithConfiguredFallback_should_not_be_called_for_local_doc_failure')
    },
    cacheJobResult: async () => {},
  })
  t.after(() => {
    __resetParseResumeJobTestOverrides()
    if (typeof previousFlag === 'undefined') delete process.env.ENABLE_LEGACY_DOC_EXTRACTION
    else process.env.ENABLE_LEGACY_DOC_EXTRACTION = previousFlag
  })

  const job = createParseJob({
    id: 'parse-enabled-doc-local-failure',
    resumeId: 'resume-enabled-doc-local-failure',
    filename: 'resume.doc',
    mimeType: 'application/msword',
    originalMimeType: 'application/msword',
    fileExtension: 'doc',
    fileBuffer: corruptOleLikeDocBuffer,
  })
  job.discard = () => {
    discarded.push(true)
    job.discarded = true
  }

  let docError = null
  await assert.rejects(
    () => __testables.runParse(job),
    (error) => {
      docError = error
      assert.match(error.message, /^legacy_doc_extraction_failed::empty_extracted_text$/)
      assert.equal(error.nonRetriable, true)
      assert.equal(error.extractionCategory, 'legacy_doc_extraction_failed')
      assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_text_extraction')
      assert.equal(error.diagnostics.fileSignature, 'legacy_doc_ole')
      return true
    },
  )

  const failure = await __testables.handleParseJobFailure(job, docError, {
    cacheFailureResult: async (jobId, payload) => cached.push({ jobId, payload }),
    logger: { warn() {} },
  })

  assert.equal(aiCalls.length, 0)
  assert.equal(failure.isNonRetriableFailure, true)
  assert.equal(failure.failurePayload.retryable, false)
  assert.equal(failure.failurePayload.retryClassification, 'legacy_doc_extraction_failed')
  assert.deepEqual(discarded, [true])
  assert.equal(cached.length, 1)
  assert.equal(queries.some(({ sql }) => String(sql).includes('INSERT INTO resume_analysis_token_usage')), false)
  assert.equal(queries.some(({ params }) => params?.includes('anthropic') || params?.includes('openai')), false)
})


async function buildMinimalDocxBuffer(text) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

function createParseJob({ id, resumeId, filename, mimeType, originalMimeType, fileExtension, fileBuffer }) {
  const progressValues = []
  return {
    id,
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: {
      resumeId,
      userId: 7,
      analysisId: 'analysis-same-base-multiformat',
      filename,
      originalFilename: filename,
      originalMimeType,
      fileExtension,
      mimeType,
      fileSize: fileBuffer.length,
      fileBufferBase64: fileBuffer.toString('base64'),
      jobDescriptionId: null,
    },
    async progress(value) {
      if (typeof value === 'number') progressValues.push(value)
      return progressValues.at(-1) || 0
    },
    discard() {
      this.discarded = true
    },
    get progressValues() {
      return progressValues
    },
  }
}


test('runParse skips duplicate PDF observe-only parsing for allowlisted and sampled PDFs', async (t) => {
  for (const scenario of [
    {
      name: 'allowlisted',
      env: {
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '0',
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ALLOWED_USER_IDS: '7',
      },
      expectedReason: 'user_allowlist',
    },
    {
      name: 'sampled',
      env: {
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED: 'true',
        PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_SAMPLE_RATE: '100',
      },
      expectedReason: 'deterministic_sample',
    },
  ]) {
    const restoreEnv = withPdfObserveOnlyEnv(scenario.env)
    const fixture = buildSyntheticPdfResumeFixture({ id: `parse-${scenario.name}-pdf` })
    let parserCalls = 0
    const mock = buildPdfJsTextContentMockFromFixtures([fixture, fixture])
    __setPdfJsClientForTests({
      ...mock,
      getDocument(...args) {
        parserCalls += 1
        return mock.getDocument(...args)
      },
    })

    const queries = []
    t.mock.method(pool, 'query', async (sql, params) => {
      queries.push({ sql, params })
      if (String(sql).includes('FROM analyses')) {
        return { rows: [{ id: 'analysis-same-base-multiformat', status: 'processing' }], rowCount: 1 }
      }
      if (String(sql).includes('FROM integration_webhooks')) {
        return { rows: [], rowCount: 0 }
      }
      return { rows: [], rowCount: 1 }
    })

    const aiCalls = []
    __setParseResumeJobTestOverrides({
      analyzeResumeWithConfiguredFallback: async (fileBufferBase64, mimeType, filename, options = {}) => {
        aiCalls.push({ fileBufferBase64, mimeType, filename, options })
        assert.equal(options.diagnosticsContext?.pdfCanonicalExtractionObserveOnlyAlreadyEvaluated, true)
        assert.equal(options.diagnosticsContext?.observeOnlyEligibility?.eligibilityReason, scenario.expectedReason)
        return {
          result: {
            candidates: [{ id: `candidate-${scenario.name}`, name: 'Synthetic Candidate', profile_score: 90 }],
            methodUsed: 'mock-pdf-binary',
          },
          provider: 'anthropic-primary',
          model: 'mock-model',
          attempts: [{ success: true, provider: 'anthropic-primary', tokenUsage: { usageAvailable: false, unavailableReason: 'test_mock' } }],
        }
      },
      cacheJobResult: async () => {},
    })

    try {
      const job = createParseJob({
        id: `parse-${scenario.name}-duplicate-guard`,
        resumeId: `resume-${scenario.name}-duplicate-guard`,
        filename: `${scenario.name}-resume.pdf`,
        mimeType: 'application/pdf',
        originalMimeType: 'application/pdf',
        fileExtension: 'pdf',
        fileBuffer: fixture.buffer,
      })
      const result = await __testables.runParse(job)

      assert.equal(parserCalls, 1)
      assert.equal(aiCalls.length, 1)
      assert.equal(aiCalls[0].fileBufferBase64, fixture.buffer.toString('base64'))
      assert.equal(aiCalls[0].mimeType, 'application/pdf')
      assert.equal(result.parseDiagnostics.preparedMimeType, 'application/pdf')
      assert.equal(result.parseDiagnostics.inputKind, 'pdf_binary')
      assert.equal(result.parseDiagnostics.inputMode, 'binary')
      assert.equal(result.parseDiagnostics.extractedTextCharCount, 0)
      assert.equal(result.parseDiagnostics.observeOnlyEligibility.eligibilityReason, scenario.expectedReason)
    } finally {
      restoreEnv()
      __resetParseResumeJobTestOverrides()
      t.mock.reset()
    }
  }
})



test('runParse prepares allowlisted PDF canonical text once for scoring experiment', async (t) => {
  const restoreEnv = withPdfObserveOnlyEnv({
    PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
    PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: '7',
  })
  const fixture = buildSyntheticPdfResumeFixture({ id: 'parse-scoring-experiment-pdf' })
  let parserCalls = 0
  const mock = buildPdfJsTextContentMockFromFixtures([fixture, fixture])
  __setPdfJsClientForTests({
    ...mock,
    getDocument(...args) {
      parserCalls += 1
      return mock.getDocument(...args)
    },
  })

  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM analyses')) {
      return { rows: [{ id: 'analysis-same-base-multiformat', status: 'processing' }], rowCount: 1 }
    }
    if (String(sql).includes('FROM integration_webhooks')) {
      return { rows: [], rowCount: 0 }
    }
    return { rows: [], rowCount: 1 }
  })

  const aiCalls = []
  __setParseResumeJobTestOverrides({
    analyzeResumeWithConfiguredFallback: async (fileBufferBase64, mimeType, filename, options = {}) => {
      aiCalls.push({ fileBufferBase64, mimeType, filename, options })
      assert.equal(options.diagnosticsContext?.pdfCanonicalExtractionObserveOnlyAlreadyEvaluated, true)
      assert.equal(options.diagnosticsContext?.pdfCanonicalTextScoringExperimentAlreadyEvaluated, true)
      assert.equal(options.diagnosticsContext?.pdfCanonicalTextScoringExperiment?.scoringFallbackReason, 'canonical_text_selected')
      return {
        result: {
          candidates: [{ id: 'candidate-scoring-experiment', name: 'Synthetic Candidate', profile_score: 91 }],
          methodUsed: 'mock-pdf-canonical-text',
        },
        provider: 'openai-primary',
        model: 'mock-model',
        attempts: [{ success: true, provider: 'openai-primary', tokenUsage: { usageAvailable: false, unavailableReason: 'test_mock' } }],
      }
    },
    cacheJobResult: async () => {},
  })

  try {
    const result = await __testables.runParse(createParseJob({
      id: 'parse-scoring-experiment-duplicate-guard',
      resumeId: 'resume-scoring-experiment-duplicate-guard',
      filename: 'scoring-experiment-resume.pdf',
      mimeType: 'application/pdf',
      originalMimeType: 'application/pdf',
      fileExtension: 'pdf',
      fileBuffer: fixture.buffer,
    }))

    assert.equal(parserCalls, 1)
    assert.equal(aiCalls.length, 1)
    assert.equal(aiCalls[0].mimeType, 'text/plain')
    assert.notEqual(aiCalls[0].fileBufferBase64, fixture.buffer.toString('base64'))
    assert.equal(result.parseDiagnostics.preparedMimeType, 'text/plain')
    assert.equal(result.parseDiagnostics.inputKind, 'extracted_text')
    assert.equal(result.parseDiagnostics.inputMode, 'extracted_text')
    assert.equal(result.parseDiagnostics.extractionMethod, 'pdfjs_dist_canonical_text_scoring_experiment')
    assert.equal(result.parseDiagnostics.pdfCanonicalTextScoringExperiment.scoringFallbackReason, 'canonical_text_selected')
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
    t.mock.reset()
  }
})

test('same-base-name PDF, DOC, and DOCX parse jobs preserve identity and route formats independently', async (t) => {
  const baseName = '04_Vikram_Rao_Junior_SDE_Resume'
  const pdfFilename = `${baseName}.pdf`
  const docFilename = `${baseName}.doc`
  const docxFilename = `${baseName}.docx`
  const pdfBuffer = Buffer.from('%PDF-1.7\nsmall test pdf body')
  const legacyDocBuffer = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from('small legacy doc body'),
  ])
  const docxBuffer = await buildMinimalDocxBuffer('Vikram Rao junior SDE resume text')

  const queries = []
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params })
    if (String(sql).includes('FROM analyses')) {
      return { rows: [{ id: 'analysis-same-base-multiformat', status: 'processing' }], rowCount: 1 }
    }
    if (String(sql).includes('FROM integration_webhooks')) {
      return { rows: [], rowCount: 0 }
    }
    return { rows: [], rowCount: 1 }
  })

  const mammothCalls = []
  __setMammothClientForTests({
    async extractRawText(input) {
      mammothCalls.push(input)
      return { value: 'Vikram Rao junior SDE resume text' }
    },
  })

  const aiCalls = []
  __setParseResumeJobTestOverrides({
    analyzeResumeWithConfiguredFallback: async (fileBufferBase64, mimeType, filename, options = {}) => {
      aiCalls.push({ fileBufferBase64, mimeType, filename, options })
      return {
        result: {
          candidates: [{
            id: `candidate-${filename}`,
            name: 'Vikram Rao',
            email: 'vikram@example.com',
            score: 88,
            profile_score: 88,
            years_experience: 1,
          }],
          methodUsed: mimeType === 'text/plain' ? 'mock-docx-extracted-text' : 'mock-pdf-binary',
        },
        provider: mimeType === 'text/plain' ? 'openai-fallback' : 'anthropic-primary',
        model: 'mock-model',
        attempts: [{
          success: true,
          provider: mimeType === 'text/plain' ? 'openai-fallback' : 'anthropic-primary',
          model: 'mock-model',
          credentialLabel: 'primary',
          providerSource: 'test_mock',
          tokenUsage: { usageAvailable: false, unavailableReason: 'test_mock' },
          inputDiagnostics: {
            sourceFormat: mimeType === 'text/plain' ? 'docx' : 'pdf',
            inputKind: mimeType === 'text/plain' ? 'extracted_text' : 'pdf_binary',
            inputMode: mimeType === 'text/plain' ? 'extracted_text' : 'binary',
            preparedMimeType: mimeType,
          },
        }],
      }
    },
    cacheJobResult: async () => {},
  })
  t.after(() => {
    __resetMammothClientForTests()
    __resetParseResumeJobTestOverrides()
  })

  const jobs = [
    createParseJob({
      id: 'parse-same-base-pdf',
      resumeId: 'resume-same-base-pdf',
      filename: pdfFilename,
      mimeType: 'application/pdf',
      originalMimeType: 'application/pdf',
      fileExtension: 'pdf',
      fileBuffer: pdfBuffer,
    }),
    createParseJob({
      id: 'parse-same-base-doc',
      resumeId: 'resume-same-base-doc',
      filename: docFilename,
      mimeType: 'application/msword',
      originalMimeType: 'application/msword',
      fileExtension: 'doc',
      fileBuffer: legacyDocBuffer,
    }),
    createParseJob({
      id: 'parse-same-base-docx',
      resumeId: 'resume-same-base-docx',
      filename: docxFilename,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileExtension: 'docx',
      fileBuffer: docxBuffer,
    }),
  ]

  const pdfResult = await __testables.runParse(jobs[0])
  let docError = null
  await assert.rejects(
    () => __testables.runParse(jobs[1]),
    (error) => {
      docError = error
      assert.equal(error.extractionCategory, 'resume_unsupported_legacy_doc')
      assert.equal(error.nonRetriable, true)
      assert.equal(error.diagnostics.extractionMethod, 'legacy_doc_rejected')
      assert.equal(error.diagnostics.extension, 'doc')
      assert.equal(error.diagnostics.fileSignature, 'legacy_doc_ole')
      return true
    },
  )
  const docFailure = await __testables.handleParseJobFailure(jobs[1], docError, {
    cacheFailureResult: async () => {},
    logger: { warn() {} },
  })
  const docxResult = await __testables.runParse(jobs[2])

  assert.deepEqual(jobs.map((job) => job.id), ['parse-same-base-pdf', 'parse-same-base-doc', 'parse-same-base-docx'])
  assert.deepEqual(jobs.map((job) => job.data.resumeId), ['resume-same-base-pdf', 'resume-same-base-doc', 'resume-same-base-docx'])
  assert.deepEqual(jobs.map((job) => job.data.originalFilename), [pdfFilename, docFilename, docxFilename])
  assert.deepEqual(jobs.map((job) => job.data.fileExtension), ['pdf', 'doc', 'docx'])
  assert.deepEqual(jobs.map((job) => job.data.originalMimeType), [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ])

  assert.equal(pdfResult.originalFilename, pdfFilename)
  assert.equal(pdfResult.fileExtension, 'pdf')
  assert.equal(pdfResult.mimeType, 'application/pdf')
  assert.equal(pdfResult.originalMimeType, 'application/pdf')
  assert.equal(pdfResult.parseDiagnostics.extractionMethod, 'pdf_binary_provider_input')
  assert.equal(pdfResult.parseDiagnostics.inputKind, 'pdf_binary')

  assert.equal(docFailure.isNonRetriableFailure, true)
  assert.equal(docFailure.failurePayload.retryable, false)
  assert.equal(jobs[1].discarded, true)

  assert.equal(docxResult.originalFilename, docxFilename)
  assert.equal(docxResult.fileExtension, 'docx')
  assert.equal(docxResult.mimeType, 'text/plain')
  assert.equal(docxResult.originalMimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(docxResult.parseDiagnostics.extractionMethod, 'docx_mammoth_text_extraction')
  assert.equal(docxResult.parseDiagnostics.inputKind, 'extracted_text')
  assert.equal(docxResult.parseDiagnostics.preparedMimeType, 'text/plain')
  assert.equal(mammothCalls.length, 1)

  assert.deepEqual(aiCalls.map((call) => call.filename), [pdfFilename, docxFilename])
  assert.deepEqual(aiCalls.map((call) => call.mimeType), ['application/pdf', 'text/plain'])
  assert.equal(aiCalls.some((call) => call.filename === docFilename), false)

  const tokenUsageInserts = queries.filter(({ sql }) => String(sql).includes('INSERT INTO resume_analysis_token_usage'))
  assert.equal(tokenUsageInserts.some(({ params }) => params?.[0] === 'resume-same-base-doc'), false)
  assert.equal(tokenUsageInserts.some(({ params }) => params?.[4] === 'anthropic-primary' && params?.[0] === 'resume-same-base-doc'), false)
  assert.equal(tokenUsageInserts.some(({ params }) => params?.[4] === 'openai-fallback' && params?.[0] === 'resume-same-base-doc'), false)

  const completedResumeUpdates = queries
    .filter(({ sql }) => String(sql).includes('UPDATE resumes') && String(sql).includes("parse_status = 'complete'"))
    .map(({ params }) => ({ resumeId: params[0], result: JSON.parse(params[1]) }))
  assert.deepEqual(completedResumeUpdates.map((update) => update.resumeId), ['resume-same-base-pdf', 'resume-same-base-docx'])
  assert.deepEqual(completedResumeUpdates.map((update) => update.result.originalFilename), [pdfFilename, docxFilename])
  assert.equal(new Set(completedResumeUpdates.map((update) => update.result.originalFilename)).size, 2)
})


test('parse job score canonicalization helper composes after JD scoring mode without mutating flag-off payload', async () => {
  const { __testables: aiTestables } = await import('../services/aiResumeAnalysisService.js')
  const [candidate] = buildNormalizedCandidates({
    candidates: [{
      score: 72,
      profile_score: 90,
      fit_assessment: { has_job_description_context: true, overall_fit_score: 78 },
      matchScore: { score: 82, score_out_of_ten: 7.1 },
    }],
  }, { resumeId: 'resume-score-off', filename: 'score.pdf' })
  const scored = applyJobDescriptionScoringMode([candidate], { hasContext: true })
  const output = aiTestables.canonicalizeAnalysisScoreFields(scored, {
    jobDescriptionContext: { hasContext: true },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'false' },
  })

  assert.strictEqual(output, scored)
  assert.deepEqual(output[0], scored[0])
  assert.equal(output[0].score, 72)
  assert.equal(output[0].matchScore.score, 82)
  assert.equal(output[0].matchScore.score_out_of_ten, 7.1)
  assert.equal(output[0].fit_assessment.overall_fit_score, 78)
  assert.equal(output[0].scoring_contract_version, undefined)
})

test('parse job score canonicalization helper uses candidate.score when JD match score is absent', async () => {
  const { __testables: aiTestables } = await import('../services/aiResumeAnalysisService.js')
  const [candidate] = buildNormalizedCandidates({
    candidates: [{
      score: 74,
      profile_score: 91,
      fit_assessment: { has_job_description_context: true, overall_fit_score: 66 },
      matchScore: null,
    }],
  }, { resumeId: 'resume-score-candidate-fallback', filename: 'score.pdf' })
  const scored = applyJobDescriptionScoringMode([candidate], { hasContext: true })
  const output = aiTestables.canonicalizeAnalysisScoreFields(scored, {
    jobDescriptionContext: { hasContext: true },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'true' },
  })

  assert.equal(output[0].score, 74)
  assert.deepEqual(output[0].matchScore, { score: 74, score_out_of_ten: 7.4 })
  assert.equal(output[0].fit_assessment.overall_fit_score, 74)
  assert.equal(output[0].canonical_score_source, 'candidate.score')
  assert.equal(output[0].canonical_score_context, 'jd_fit')
})

test('parse job score canonicalization helper preserves JD-missing semantics when enabled', async () => {
  const { __testables: aiTestables } = await import('../services/aiResumeAnalysisService.js')
  const [candidate] = buildNormalizedCandidates({
    candidates: [{
      score: 0,
      profile_score: 78,
      fit_assessment: { has_job_description_context: true, overall_fit_score: 82 },
      matchScore: { score: 82, score_out_of_ten: 8.2 },
    }],
  }, { resumeId: 'resume-score-profile', filename: 'score.pdf' })
  const scored = applyJobDescriptionScoringMode([candidate], { hasContext: false })
  const output = aiTestables.canonicalizeAnalysisScoreFields(scored, {
    jobDescriptionContext: { hasContext: false },
    env: { AI_CANONICALIZE_SCORE_FIELDS: 'true' },
  })

  assert.equal(output[0].score, 78)
  assert.equal(output[0].matchScore, null)
  assert.equal(output[0].fit_assessment.overall_fit_score, null)
  assert.equal(output[0].canonical_score_source, 'profile_score')
  assert.equal(output[0].canonical_score_context, 'profile_only')
})

function withAiScoreCacheEnv(overrides = {}) {
  const keys = [
    'AI_SCORE_CACHE_ENABLED',
    'AI_SCORE_CACHE_ALLOWED_USER_IDS',
    'AI_SCORE_CACHE_ALLOWED_ANALYSIS_IDS',
  ]
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value
  }
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

test('AI score cache write-only shadow skips storage when flag is off', async () => {
  const restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'false', AI_SCORE_CACHE_ALLOWED_USER_IDS: '24' })
  const upserts = []
  __setParseResumeJobTestOverrides({ upsertScoreCacheEntry: async (payload) => upserts.push(payload) })

  try {
    const result = await __testables.writeAiScoreCacheShadow({
      candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
      preparedResumePayload: { extractedText: 'Safe scoring text' },
      jobDescriptionContext: { hasContext: false, source: 'none' },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info() {}, warn() {} },
    })

    assert.equal(result.stored, false)
    assert.equal(upserts.length, 0)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score cache write-only shadow skips storage when allowlists do not match', async () => {
  const restoreEnv = withAiScoreCacheEnv({
    AI_SCORE_CACHE_ENABLED: 'true',
    AI_SCORE_CACHE_ALLOWED_USER_IDS: '25',
    AI_SCORE_CACHE_ALLOWED_ANALYSIS_IDS: 'analysis-2',
  })
  const upserts = []
  __setParseResumeJobTestOverrides({ upsertScoreCacheEntry: async (payload) => upserts.push(payload) })

  try {
    const result = await __testables.writeAiScoreCacheShadow({
      candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
      preparedResumePayload: { extractedText: 'Safe scoring text' },
      jobDescriptionContext: { hasContext: false, source: 'none' },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info() {}, warn() {} },
    })

    assert.equal(result.stored, false)
    assert.equal(upserts.length, 0)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score cache write-only shadow upserts once when eligible and stores only safe payload fields', async () => {
  const restoreEnv = withAiScoreCacheEnv({
    AI_SCORE_CACHE_ENABLED: 'true',
    AI_SCORE_CACHE_ALLOWED_USER_IDS: '24',
    AI_SCORE_CACHE_ALLOWED_ANALYSIS_IDS: 'analysis-1',
  })
  const upserts = []
  __setParseResumeJobTestOverrides({ upsertScoreCacheEntry: async (payload) => { upserts.push(payload); return { stored: true } } })

  try {
    const result = await __testables.writeAiScoreCacheShadow({
      candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
      preparedResumePayload: { extractedText: 'Jane Candidate jane@example.com 555-1212 resume text' },
      jobDescriptionContext: { hasContext: true, source: 'manual_text', description: 'Build APIs', requirements: 'Node', skills: ['node'] },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info() {}, warn() {} },
    })

    assert.equal(result.stored, true)
    assert.equal(upserts.length, 1)
    assert.match(upserts[0].cache_key, /^score_cache_v1:/)
    assert.equal(upserts[0].canonical_score, 82)
    assert.equal(upserts[0].score_out_of_ten, 8.2)
    assert.equal(upserts[0].provider, 'openai-primary')
    assert.equal(upserts[0].model, 'gpt-test')
    assert.equal(JSON.stringify(upserts[0]).includes('Jane Candidate'), false)
    assert.equal(JSON.stringify(upserts[0]).includes('jane@example.com'), false)
    assert.equal(JSON.stringify(upserts[0]).includes('555-1212'), false)
    assert.equal(JSON.stringify(upserts[0]).includes('Build APIs'), false)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score cache write-only shadow write failures and missing key fields fail open', async () => {
  const restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'true', AI_SCORE_CACHE_ALLOWED_USER_IDS: '24' })
  const upserts = []
  __setParseResumeJobTestOverrides({ upsertScoreCacheEntry: async (payload) => { upserts.push(payload); throw new Error('db unavailable') } })

  try {
    const failedWrite = await __testables.writeAiScoreCacheShadow({
      candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
      preparedResumePayload: { extractedText: 'Safe scoring text' },
      jobDescriptionContext: { hasContext: false, source: 'none' },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info() {}, warn() {} },
    })
    assert.equal(failedWrite.stored, false)
    assert.equal(upserts.length, 1)

    const missingKey = await __testables.writeAiScoreCacheShadow({
      candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1' },
      preparedResumePayload: { extractedText: '' },
      jobDescriptionContext: { hasContext: false, source: 'none' },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info() {}, warn() {} },
    })
    assert.equal(missingKey.stored, false)
    assert.equal(upserts.length, 1)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})


test('AI score cache write-only shadow requires canonical scoring contract before upsert', async () => {
  const restoreEnv = withAiScoreCacheEnv({
    AI_SCORE_CACHE_ENABLED: 'true',
    AI_SCORE_CACHE_ALLOWED_USER_IDS: '24',
  })
  const upserts = []
  __setParseResumeJobTestOverrides({ upsertScoreCacheEntry: async (payload) => { upserts.push(payload); return { stored: true } } })

  try {
    const missingContract = await __testables.writeAiScoreCacheShadow({
      candidate: { score: 82, canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
      preparedResumePayload: { extractedText: 'Safe scoring text' },
      jobDescriptionContext: { hasContext: false, source: 'none' },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info() {}, warn() {} },
    })
    assert.equal(missingContract.stored, false)
    assert.equal(missingContract.diagnostic.reason, 'missing_or_unsupported_scoring_contract_version')
    assert.equal(upserts.length, 0)

    const validContract = await __testables.writeAiScoreCacheShadow({
      candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
      preparedResumePayload: { extractedText: 'Safe scoring text' },
      jobDescriptionContext: { hasContext: false, source: 'none' },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info() {}, warn() {} },
    })
    assert.equal(validContract.stored, true)
    assert.equal(upserts.length, 1)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score cache write-only shadow requires an explicit runtime allowlist match', async () => {
  let restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'true' })
  const upserts = []
  __setParseResumeJobTestOverrides({ upsertScoreCacheEntry: async (payload) => { upserts.push(payload); return { stored: true } } })

  const request = {
    candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
    preparedResumePayload: { extractedText: 'Safe scoring text' },
    jobDescriptionContext: { hasContext: false, source: 'none' },
    userId: 24,
    analysisId: 'analysis-1',
    aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
    logger: { info() {}, warn() {} },
  }

  try {
    const missingAllowlist = await __testables.writeAiScoreCacheShadow(request)
    assert.equal(missingAllowlist.stored, false)
    assert.equal(missingAllowlist.diagnostic.reason, 'missing_runtime_allowlist')
    assert.equal(upserts.length, 0)

    restoreEnv()
    restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'true', AI_SCORE_CACHE_ALLOWED_USER_IDS: '24' })
    const userMatched = await __testables.writeAiScoreCacheShadow(request)
    assert.equal(userMatched.stored, true)
    assert.equal(upserts.length, 1)

    restoreEnv()
    restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'true', AI_SCORE_CACHE_ALLOWED_ANALYSIS_IDS: 'analysis-1' })
    const analysisMatched = await __testables.writeAiScoreCacheShadow(request)
    assert.equal(analysisMatched.stored, true)
    assert.equal(upserts.length, 2)

    restoreEnv()
    restoreEnv = withAiScoreCacheEnv({
      AI_SCORE_CACHE_ENABLED: 'true',
      AI_SCORE_CACHE_ALLOWED_USER_IDS: '25',
      AI_SCORE_CACHE_ALLOWED_ANALYSIS_IDS: 'analysis-2',
    })
    const nonMatched = await __testables.writeAiScoreCacheShadow(request)
    assert.equal(nonMatched.stored, false)
    assert.equal(upserts.length, 2)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score cache read-shadow skips reads when flag is off or allowlist is missing', async () => {
  let restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'false', AI_SCORE_CACHE_ALLOWED_USER_IDS: '24' })
  const reads = []
  __setParseResumeJobTestOverrides({ getScoreCacheEntry: async (cacheKey) => reads.push(cacheKey) })

  const request = {
    candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
    preparedResumePayload: { extractedText: 'Safe scoring text' },
    jobDescriptionContext: { hasContext: false, source: 'none' },
    userId: 24,
    analysisId: 'analysis-1',
    aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
    logger: { info() {}, warn() {} },
  }

  try {
    const flagOff = await __testables.readAiScoreCacheShadowDiagnostic(request)
    assert.equal(flagOff.checked, false)
    assert.equal(reads.length, 0)

    restoreEnv()
    restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'true' })
    const noAllowlist = await __testables.readAiScoreCacheShadowDiagnostic(request)
    assert.equal(noAllowlist.checked, false)
    assert.equal(reads.length, 0)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score cache read-shadow reads eligible keys, logs safe miss, and does not change candidate', async () => {
  const restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'true', AI_SCORE_CACHE_ALLOWED_USER_IDS: '24' })
  const reads = []
  const logs = []
  const candidate = { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' }
  __setParseResumeJobTestOverrides({
    getScoreCacheEntry: async (cacheKey) => {
      reads.push(cacheKey)
      return { found: false, entry: null }
    },
  })

  try {
    const before = structuredClone(candidate)
    const result = await __testables.readAiScoreCacheShadowDiagnostic({
      candidate,
      preparedResumePayload: { extractedText: 'Jane Candidate jane@example.com 555-1212 resume text' },
      jobDescriptionContext: { hasContext: true, source: 'manual_text', description: 'Build APIs', requirements: 'Node', skills: ['node'] },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    })

    assert.equal(result.checked, true)
    assert.equal(result.hit, false)
    assert.equal(reads.length, 1)
    assert.match(reads[0], /^score_cache_v1:/)
    assert.deepEqual(candidate, before)
    assert.equal(logs[0][0], '[AiScoreCache] read-shadow diagnostic')
    assert.equal(logs[0][1].action, 'read_shadow_miss')
    assert.equal(logs[0][1].cache_hit, false)
    assert.equal(logs[0][1].same_score, null)
    assert.equal(logs[0][1].score_delta, null)
    assert.ok(logs[0][1].cache_key_fingerprint)
    const serializedLog = JSON.stringify(logs)
    assert.equal(serializedLog.includes(reads[0]), false)
    assert.equal(serializedLog.includes('Jane Candidate'), false)
    assert.equal(serializedLog.includes('jane@example.com'), false)
    assert.equal(serializedLog.includes('555-1212'), false)
    assert.equal(serializedLog.includes('Build APIs'), false)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score cache read-shadow logs safe hit comparison without score override', async () => {
  const restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'true', AI_SCORE_CACHE_ALLOWED_ANALYSIS_IDS: 'analysis-1' })
  const candidate = { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' }
  const logs = []
  __setParseResumeJobTestOverrides({
    getScoreCacheEntry: async () => ({ found: true, entry: { canonical_score: 80 } }),
  })

  try {
    const result = await __testables.readAiScoreCacheShadowDiagnostic({
      candidate,
      preparedResumePayload: { extractedText: 'Safe scoring text' },
      jobDescriptionContext: { hasContext: false, source: 'none' },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    })

    assert.equal(result.checked, true)
    assert.equal(result.hit, true)
    assert.equal(candidate.score, 82)
    assert.equal(logs[0][1].action, 'read_shadow_hit')
    assert.equal(logs[0][1].cache_hit, true)
    assert.equal(logs[0][1].same_score, false)
    assert.equal(logs[0][1].score_delta, -2)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score cache read-shadow read failures fail open and do not fail parse diagnostics', async () => {
  const restoreEnv = withAiScoreCacheEnv({ AI_SCORE_CACHE_ENABLED: 'true', AI_SCORE_CACHE_ALLOWED_USER_IDS: '24' })
  const logs = []
  __setParseResumeJobTestOverrides({
    getScoreCacheEntry: async () => { throw new Error('db unavailable with cache key score_cache_v1:secret') },
  })

  try {
    const result = await __testables.readAiScoreCacheShadowDiagnostic({
      candidate: { score: 82, scoring_contract_version: 'canonical_score_fields_v1', canonical_score_source: 'matchScore.score', canonical_score_context: 'jd_fit' },
      preparedResumePayload: { extractedText: 'Safe scoring text' },
      jobDescriptionContext: { hasContext: false, source: 'none' },
      userId: 24,
      analysisId: 'analysis-1',
      aiResponse: { provider: 'openai-primary', model: 'gpt-test', promptVersion: 1, mode: 'compact' },
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    })

    assert.equal(result.checked, true)
    assert.equal(result.hit, false)
    assert.equal(result.diagnostic.action, 'read_shadow_failed_open')
    assert.equal(logs[0][0], '[AiScoreCache] read-shadow diagnostic')
    assert.equal(JSON.stringify(logs).includes('db unavailable'), false)
    assert.equal(JSON.stringify(logs).includes('score_cache_v1:secret'), false)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

function withDeterministicJdFitShadowEnv(overrides = {}) {
  const keys = [
    'DETERMINISTIC_JD_FIT_SHADOW_ENABLED',
    'DETERMINISTIC_JD_FIT_SHADOW_ALLOWED_USER_IDS',
    'DETERMINISTIC_JD_FIT_SHADOW_ALLOWED_ANALYSIS_IDS',
    'DETERMINISTIC_JD_FIT_APPLY_ENABLED',
    'DETERMINISTIC_JD_FIT_APPLY_ALLOWED_USER_IDS',
    'DETERMINISTIC_JD_FIT_APPLY_ALLOWED_ANALYSIS_IDS',
  ]
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value
  }
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

function deterministicShadowCandidateFixture() {
  return {
    resumeId: 'resume-1',
    name: 'Private Candidate',
    email: 'private@example.com',
    phone: '555-0101',
    score: 82,
    matchScore: { score: 82, reason: 'Do not log recommendation text' },
    fit_assessment: {
      overall_fit_score: 82,
      matched_requirements: ['Do not log matched raw requirement'],
      missing_requirements: ['Do not log missing raw requirement'],
      rationale: 'Do not log rationale text',
    },
    skills_flat: ['Node.js', 'Postgres'],
    top_skills: ['Node.js'],
    years_experience: 6,
    location: 'Remote',
  }
}

test('deterministic JD-fit shadow skips silently when flag is off', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({ DETERMINISTIC_JD_FIT_SHADOW_ENABLED: 'false', DETERMINISTIC_JD_FIT_SHADOW_ALLOWED_USER_IDS: '24' })
  const logs = []
  let calls = 0
  __setParseResumeJobTestOverrides({ scoreCandidateDeterministically: () => { calls += 1; return {} } })

  try {
    const result = __testables.emitDeterministicJdFitShadowDiagnostic({
      candidate: deterministicShadowCandidateFixture(),
      jobDescriptionContext: { hasContext: true, requirements: 'Node', skills: ['Node.js'] },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    })

    assert.equal(result.computed, false)
    assert.equal(result.diagnostic, null)
    assert.equal(calls, 0)
    assert.equal(logs.length, 0)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('deterministic JD-fit shadow logs skip and does not score without allowlist match', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({ DETERMINISTIC_JD_FIT_SHADOW_ENABLED: 'true' })
  const logs = []
  let calls = 0
  __setParseResumeJobTestOverrides({ scoreCandidateDeterministically: () => { calls += 1; return {} } })

  try {
    const result = __testables.emitDeterministicJdFitShadowDiagnostic({
      candidate: deterministicShadowCandidateFixture(),
      jobDescriptionContext: { hasContext: true, requirements: 'Node', skills: ['Node.js'] },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    })

    assert.equal(result.computed, false)
    assert.equal(calls, 0)
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], '[DeterministicJdFit] shadow diagnostic')
    assert.equal(typeof logs[0][1], 'string')
    const diagnostic = JSON.parse(logs[0][1])
    assert.equal(diagnostic.action, 'skip')
    assert.equal(diagnostic.allowlist_matched, false)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('deterministic JD-fit shadow computes safe diagnostic without mutating candidate or production score', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({
    DETERMINISTIC_JD_FIT_SHADOW_ENABLED: 'true',
    DETERMINISTIC_JD_FIT_SHADOW_ALLOWED_USER_IDS: '24',
  })
  const logs = []
  const candidate = deterministicShadowCandidateFixture()
  const before = structuredClone(candidate)
  let calls = 0
  __setParseResumeJobTestOverrides({
    scoreCandidateDeterministically: (scoredCandidate, context) => {
      calls += 1
      assert.strictEqual(scoredCandidate, candidate)
      assert.equal(context.hasContext, true)
      return {
        final_score: 74.5,
        scoring_contract_version: 'deterministic_jd_fit_v1',
        scoring_mode: 'jd_fit',
        score_band: 'strong',
        verdict: 'Aligned',
        scoring_breakdown: {
          requirement_match: { score: 80 },
          skill_alignment: { score: 70 },
          experience_alignment: { score: 90 },
          location_alignment: { score: 65 },
          evidence_completeness: { score: 100 },
          risk_penalty: { penalty: 2 },
          confidence_adjustment: { multiplier: 0.98 },
        },
      }
    },
  })

  try {
    const result = __testables.emitDeterministicJdFitShadowDiagnostic({
      candidate,
      jobDescriptionContext: { hasContext: true, description: 'Do not log raw JD', requirements: 'Node', skills: ['Node.js'] },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      provider: 'openai-primary',
      model: 'gpt-test',
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    })

    assert.equal(result.computed, true)
    assert.equal(calls, 1)
    assert.deepEqual(candidate, before)
    assert.equal(candidate.score, 82)
    assert.equal(candidate.matchScore.score, 82)
    assert.equal(candidate.fit_assessment.overall_fit_score, 82)
    assert.equal(logs[0][0], '[DeterministicJdFit] shadow diagnostic')
    assert.equal(typeof logs[0][1], 'string')
    const diagnostic = JSON.parse(logs[0][1])
    assert.deepEqual(Object.keys(diagnostic).sort(), [
      'action', 'allowlist_matched', 'analysis_id', 'confidence_multiplier', 'current_ai_score',
      'deterministic_final_score', 'evidence_score', 'experience_relevance_cap_applied', 'experience_score',
      'final_score_before_rounding', 'has_jd_context', 'location_score', 'model', 'normalized_requirement_match_count',
      'normalized_requirement_missing_count', 'provider', 'requirement_bucket_score_keys', 'requirement_matched_bucket_count',
      'requirement_missing_bucket_count', 'requirement_score', 'resume_id', 'risk_penalty',
      'role_gap_signal_count', 'score_band', 'score_cap_applied', 'score_delta', 'scoring_contract_version', 'scoring_mode',
      'skill_bucket_score_keys', 'skill_matched_bucket_count', 'skill_missing_bucket_count', 'skill_score',
      'structured_positive_applied_bucket_count', 'structured_positive_bucket_count',
      'user_id', 'verdict',
    ].sort())
    assert.equal(diagnostic.action, 'computed')
    assert.equal(diagnostic.provider, 'openai-primary')
    assert.equal(diagnostic.model, 'gpt-test')
    assert.equal(diagnostic.deterministic_final_score, 74.5)
    assert.equal(diagnostic.current_ai_score, 82)
    assert.equal(diagnostic.score_delta, -7.5)
    const serializedLog = JSON.stringify(logs)
    for (const forbidden of ['Private Candidate', 'private@example.com', '555-0101', 'Do not log raw JD', 'Do not log rationale text', 'Do not log matched raw requirement', 'Do not log recommendation text']) {
      assert.equal(serializedLog.includes(forbidden), false)
    }
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('deterministic JD-fit shadow failure logs failed_open and does not fail parse diagnostics', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({
    DETERMINISTIC_JD_FIT_SHADOW_ENABLED: 'true',
    DETERMINISTIC_JD_FIT_SHADOW_ALLOWED_ANALYSIS_IDS: 'analysis-1',
  })
  const logs = []
  const candidate = deterministicShadowCandidateFixture()
  const before = structuredClone(candidate)
  __setParseResumeJobTestOverrides({
    scoreCandidateDeterministically: () => { throw new Error('scorer failed with private@example.com and raw text') },
  })

  try {
    const result = __testables.emitDeterministicJdFitShadowDiagnostic({
      candidate,
      jobDescriptionContext: { hasContext: true, requirements: 'Node' },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    })

    assert.equal(result.computed, false)
    assert.equal(result.diagnostic.action, 'failed_open')
    assert.deepEqual(candidate, before)
    assert.equal(logs[0][0], '[DeterministicJdFit] shadow diagnostic')
    assert.equal(typeof logs[0][1], 'string')
    assert.equal(JSON.parse(logs[0][1]).action, 'failed_open')
    assert.equal(JSON.stringify(logs).includes('private@example.com'), false)
    assert.equal(JSON.stringify(logs).includes('raw text'), false)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('deterministic JD-fit apply disabled leaves candidate scores unchanged', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({
    DETERMINISTIC_JD_FIT_APPLY_ENABLED: 'false',
    DETERMINISTIC_JD_FIT_APPLY_ALLOWED_USER_IDS: '24',
  })
  let calls = 0
  __setParseResumeJobTestOverrides({
    scoreCandidateDeterministically: () => {
      calls += 1
      return { final_score: 74.5, scoring_contract_version: 'deterministic_jd_fit_v1', scoring_mode: 'jd_fit' }
    },
  })

  try {
    const candidate = deterministicShadowCandidateFixture()
    const result = __testables.applyDeterministicJdFitScoresForRuntimeTest({
      candidates: [candidate],
      jobDescriptionContext: { hasContext: true, requirements: 'Node', skills: ['Node.js'] },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: () => {}, warn: () => {} },
    })

    assert.strictEqual(result[0], candidate)
    assert.equal(result[0].score, 82)
    assert.equal(result[0].matchScore.score, 82)
    assert.equal(calls, 0)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('deterministic JD-fit apply enabled without allowlist leaves candidate scores unchanged', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({ DETERMINISTIC_JD_FIT_APPLY_ENABLED: 'true' })
  let calls = 0
  __setParseResumeJobTestOverrides({
    scoreCandidateDeterministically: () => {
      calls += 1
      return { final_score: 74.5, scoring_contract_version: 'deterministic_jd_fit_v1', scoring_mode: 'jd_fit' }
    },
  })

  try {
    const candidate = deterministicShadowCandidateFixture()
    const result = __testables.applyDeterministicJdFitScoresForRuntimeTest({
      candidates: [candidate],
      jobDescriptionContext: { hasContext: true, requirements: 'Node', skills: ['Node.js'] },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: () => {}, warn: () => {} },
    })

    assert.strictEqual(result[0], candidate)
    assert.equal(result[0].score, 82)
    assert.equal(result[0].matchScore.score, 82)
    assert.equal(calls, 0)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('deterministic JD-fit apply replaces user-allowlisted JD-backed scores and preserves reasoning fields', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({
    DETERMINISTIC_JD_FIT_APPLY_ENABLED: 'true',
    DETERMINISTIC_JD_FIT_APPLY_ALLOWED_USER_IDS: '24',
  })
  const logs = []
  __setParseResumeJobTestOverrides({
    scoreCandidateDeterministically: () => ({
      final_score: 74.5,
      scoring_contract_version: 'deterministic_jd_fit_v1',
      scoring_mode: 'jd_fit',
    }),
  })

  try {
    const candidate = {
      ...deterministicShadowCandidateFixture(),
      strengths: ['Strong backend delivery'],
      considerations: ['Limited Kubernetes'],
      fit_assessment: {
        ...deterministicShadowCandidateFixture().fit_assessment,
        missing_requirements: ['Kubernetes'],
      },
    }
    const result = __testables.applyDeterministicJdFitScoresForRuntimeTest({
      candidates: [candidate],
      jobDescriptionContext: { hasContext: true, requirements: 'Node', skills: ['Node.js'] },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    })

    assert.notStrictEqual(result[0], candidate)
    assert.equal(result[0].score, 74.5)
    assert.equal(result[0].matchScore.score, 74.5)
    assert.equal(result[0].matchScore.score_out_of_ten, 7.5)
    assert.equal(result[0].fit_assessment.overall_fit_score, 74.5)
    assert.equal(result[0].matchScore.reason, 'Do not log recommendation text')
    assert.deepEqual(result[0].strengths, ['Strong backend delivery'])
    assert.deepEqual(result[0].considerations, ['Limited Kubernetes'])
    assert.deepEqual(result[0].fit_assessment.matched_requirements, ['Do not log matched raw requirement'])
    assert.deepEqual(result[0].fit_assessment.missing_requirements, ['Kubernetes'])
    assert.equal(result[0].deterministic_jd_fit_apply_metadata.original_ai_score, 82)
    assert.equal(__testables.hasDeterministicJdFitAppliedScore(result[0]), true)
    assert.equal(logs[0][0], '[DeterministicJdFit] apply diagnostic')
    assert.equal(logs[0][1].action, 'applied')
    assert.equal(JSON.stringify(logs).includes('Private Candidate'), false)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('deterministic JD-fit apply replaces analysis-allowlisted JD-backed scores', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({
    DETERMINISTIC_JD_FIT_APPLY_ENABLED: 'true',
    DETERMINISTIC_JD_FIT_APPLY_ALLOWED_ANALYSIS_IDS: 'analysis-1',
  })
  __setParseResumeJobTestOverrides({
    scoreCandidateDeterministically: () => ({
      final_score: 50.1,
      scoring_contract_version: 'deterministic_jd_fit_v1',
      scoring_mode: 'jd_fit',
    }),
  })

  try {
    const result = __testables.applyDeterministicJdFitScoresForRuntimeTest({
      candidates: [deterministicShadowCandidateFixture()],
      jobDescriptionContext: { hasContext: true, requirements: 'Node', skills: ['Node.js'] },
      userId: 999,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: () => {}, warn: () => {} },
    })

    assert.equal(result[0].score, 50.1)
    assert.equal(result[0].matchScore.score, 50.1)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('AI score-cache shadow gate skips deterministic-applied candidates only', () => {
  const aiCandidate = deterministicShadowCandidateFixture()
  const deterministicAppliedCandidate = {
    ...deterministicShadowCandidateFixture(),
    deterministic_jd_fit_apply_metadata: {
      original_ai_score: 82,
      applied_deterministic_score: 74.5,
      scoring_contract_version: 'deterministic_jd_fit_v1',
      scoring_mode: 'jd_fit',
    },
  }

  assert.equal(__testables.hasDeterministicJdFitAppliedScore(aiCandidate), false)
  assert.equal(__testables.hasDeterministicJdFitAppliedScore(deterministicAppliedCandidate), true)
  assert.equal(__testables.shouldSkipAiScoreCacheShadowForCandidate(aiCandidate), false)
  assert.equal(__testables.shouldSkipAiScoreCacheShadowForCandidate(deterministicAppliedCandidate), true)
})

test('deterministic JD-fit apply leaves no-JD and non-finite deterministic scores unchanged', () => {
  const restoreEnv = withDeterministicJdFitShadowEnv({
    DETERMINISTIC_JD_FIT_APPLY_ENABLED: 'true',
    DETERMINISTIC_JD_FIT_APPLY_ALLOWED_USER_IDS: '24',
  })
  __setParseResumeJobTestOverrides({
    scoreCandidateDeterministically: () => ({
      final_score: Number.NaN,
      scoring_contract_version: 'deterministic_jd_fit_v1',
      scoring_mode: 'jd_fit',
    }),
  })

  try {
    const noJdCandidate = deterministicShadowCandidateFixture()
    const noJdResult = __testables.applyDeterministicJdFitScoresForRuntimeTest({
      candidates: [noJdCandidate],
      jobDescriptionContext: { hasContext: false },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: () => {}, warn: () => {} },
    })
    assert.strictEqual(noJdResult[0], noJdCandidate)
    assert.equal(noJdResult[0].score, 82)

    const nonFiniteCandidate = deterministicShadowCandidateFixture()
    const nonFiniteResult = __testables.applyDeterministicJdFitScoresForRuntimeTest({
      candidates: [nonFiniteCandidate],
      jobDescriptionContext: { hasContext: true, requirements: 'Node', skills: ['Node.js'] },
      userId: 24,
      analysisId: 'analysis-1',
      resumeId: 'resume-1',
      logger: { info: () => {}, warn: () => {} },
    })
    assert.strictEqual(nonFiniteResult[0], nonFiniteCandidate)
    assert.equal(nonFiniteResult[0].matchScore.score, 82)
  } finally {
    restoreEnv()
    __resetParseResumeJobTestOverrides()
  }
})

test('buildNormalizedCandidates preserves normalized ai_scoring_contract_v2 and does not replace visible score fields', () => {
  const [candidate] = buildNormalizedCandidates({
    candidates: [{
      score: 88,
      matchScore: { score: 88, score_out_of_ten: 8.8 },
      fit_assessment: { has_job_description_context: true, overall_fit_score: 88 },
      ai_scoring_contract_v2: {
        scoring_contract_version: 'ai_jd_fit_rubric_v2',
        skills_match_score: 55,
        relevant_experience_score: 55,
        education_relevance_score: 55,
        seniority_progression_score: 55,
        weighted_total_score: 55,
        score_confidence: 'low',
      },
    }],
  }, { resumeId: 'resume-v2', filename: 'candidate.pdf' })

  assert.equal(candidate.score, 88)
  assert.equal(candidate.matchScore.score, 88)
  assert.equal(candidate.fit_assessment.overall_fit_score, 88)
  assert.equal(candidate.ai_scoring_contract_v2.weighted_total_score_recomputed, 55)
})
