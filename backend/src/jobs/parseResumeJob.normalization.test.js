import { Buffer } from 'node:buffer'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

import {
  __resetParseResumeJobTestOverrides,
  __setParseResumeJobTestOverrides,
  __testables,
} from './parseResumeJob.js'
import { __resetMammothClientForTests, __setMammothClientForTests } from '../services/resumeDocumentExtractionService.js'
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
