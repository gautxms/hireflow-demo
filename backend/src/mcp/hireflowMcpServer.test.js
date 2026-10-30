import test from 'node:test'
import assert from 'node:assert/strict'
import {
  downloadOpenAIFile,
  downloadOpenAIResumeFile,
  HIRE_FLOW_MCP_SERVER_INSTRUCTIONS,
  HIRE_FLOW_MCP_TOOLS,
} from './hireflowMcpServer.js'

test('MCP tool catalog separates read-only discovery from native-approved creation', () => {
  assert.deepEqual(HIRE_FLOW_MCP_TOOLS.map((tool) => tool.name), [
    'get_current_profile',
    'list_jobs',
    'get_resume_quota',
    'get_analysis_status',
    'get_analysis_results',
    'render_analysis_results',
    'preview_job_description',
    'create_job_from_preview',
    'create_resume_analysis',
  ])

  const profile = HIRE_FLOW_MCP_TOOLS[0]
  assert.equal(profile.annotations.readOnlyHint, true)
  assert.equal(profile.annotations.idempotentHint, true)
  assert.equal(profile._meta['openai/profile'], true)
  assert.deepEqual(profile.securitySchemes, [{ type: 'oauth2', scopes: ['mcp:profile'] }])

  const listJobs = HIRE_FLOW_MCP_TOOLS.find((tool) => tool.name === 'list_jobs')
  const quota = HIRE_FLOW_MCP_TOOLS.find((tool) => tool.name === 'get_resume_quota')
  const status = HIRE_FLOW_MCP_TOOLS.find((tool) => tool.name === 'get_analysis_status')
  const results = HIRE_FLOW_MCP_TOOLS.find((tool) => tool.name === 'get_analysis_results')
  const renderResults = HIRE_FLOW_MCP_TOOLS.find((tool) => tool.name === 'render_analysis_results')
  assert.equal(listJobs.annotations.readOnlyHint, true)
  assert.equal(quota.annotations.readOnlyHint, true)
  assert.equal(status.annotations.readOnlyHint, true)
  assert.equal(results.annotations.readOnlyHint, true)
  assert.equal(results.annotations.idempotentHint, true)
  assert.equal(results.inputSchema.required.includes('analysisId'), true)
  assert.ok(results.outputSchema.properties.candidates)
  assert.equal(renderResults.annotations.readOnlyHint, true)
  assert.equal(renderResults._meta.ui.resourceUri, 'ui://hireflow/analysis-results-v3.html')
  assert.deepEqual(renderResults._meta.ui.visibility, ['model', 'app'])
  assert.equal(renderResults._meta['openai/outputTemplate'], 'ui://hireflow/analysis-results-v3.html')
  assert.equal(renderResults._meta['openai/toolInvocation/invoking'], 'Loading HireFlow results…')

  const preview = HIRE_FLOW_MCP_TOOLS.find((tool) => tool.name === 'preview_job_description')
  assert.deepEqual(preview._meta['openai/fileParams'], ['file'])
  const fileDefinition = preview.inputSchema.properties.file
  assert.deepEqual(fileDefinition.required, ['download_url', 'file_id'])
  assert.ok(fileDefinition.properties.mime_type)
  assert.ok(fileDefinition.properties.file_name)
  assert.equal(preview.annotations.readOnlyHint, true)
  assert.deepEqual(preview.securitySchemes, [{ type: 'oauth2', scopes: ['mcp:profile', 'jobs:write'] }])

  const create = HIRE_FLOW_MCP_TOOLS.find((tool) => tool.name === 'create_job_from_preview')
  assert.equal(create.inputSchema.properties.confirmed, undefined)
  assert.ok(!create.inputSchema.required.includes('confirmed'))
  assert.deepEqual(create._meta['openai/fileParams'], ['file'])
  assert.equal(create.annotations.readOnlyHint, false)

  const createAnalysis = HIRE_FLOW_MCP_TOOLS.find((tool) => tool.name === 'create_resume_analysis')
  assert.deepEqual(createAnalysis._meta['openai/fileParams'], ['files'])
  assert.deepEqual(createAnalysis.securitySchemes, [{
    type: 'oauth2',
    scopes: ['mcp:profile', 'analyses:write'],
  }])
  assert.equal(createAnalysis.inputSchema.properties.confirmed, undefined)
  assert.ok(!createAnalysis.inputSchema.required.includes('confirmed'))
  assert.equal(createAnalysis.inputSchema.properties.files.minItems, 1)
  assert.equal(createAnalysis.inputSchema.properties.files.maxItems, 20)
  assert.equal(createAnalysis.annotations.idempotentHint, false)
  assert.equal(createAnalysis._meta.ui.resourceUri, 'ui://hireflow/analysis-results-v3.html')
  assert.deepEqual(createAnalysis._meta.ui.visibility, ['model', 'app'])
  assert.equal(createAnalysis._meta['openai/outputTemplate'], 'ui://hireflow/analysis-results-v3.html')
  assert.equal(createAnalysis._meta['openai/toolInvocation/invoking'], 'Starting HireFlow analysis…')
  assert.equal(createAnalysis._meta['openai/toolInvocation/invoked'], 'HireFlow analysis started')
  assert.match(createAnalysis.description, /tracks progress and displays the final authoritative results automatically/)
  assert.match(HIRE_FLOW_MCP_SERVER_INSTRUCTIONS, /Do not call get_analysis_status, get_analysis_results, or render_analysis_results after successful creation/)
  assert.match(HIRE_FLOW_MCP_SERVER_INSTRUCTIONS, /do not add candidate summaries, tables, scores, rankings, or recommendations outside the component/)
})

test('ChatGPT file downloads enforce host, redirects, and byte limits', async () => {
  const pdf = Buffer.from('%PDF-1.7\njob description')
  const downloaded = await downloadOpenAIFile({
    download_url: 'https://files.oaiusercontent.com/private/job.pdf?signature=redacted',
    file_id: 'file_123',
    mime_type: 'application/pdf',
    file_name: 'job.pdf',
  }, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error')
      return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
    },
  })
  assert.equal(downloaded.originalname, 'job.pdf')
  assert.equal(downloaded.mimetype, 'application/pdf')
  assert.deepEqual(downloaded.buffer, pdf)

  await assert.rejects(
    downloadOpenAIFile({ download_url: 'https://example.com/job.pdf', file_id: 'file_123' }),
    /not from an approved ChatGPT file host/,
  )

  await assert.rejects(
    downloadOpenAIFile({ download_url: 'https://files.oaiusercontent.com/job.pdf', file_id: 'file_123' }, {
      fetchImpl: async () => new Response('small', {
        status: 200,
        headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
      }),
    }),
    /20MB or smaller/,
  )
})

test('ChatGPT resume downloads accept supported resume formats and enforce 25MB', async () => {
  const doc = Buffer.from('legacy word resume')
  const downloaded = await downloadOpenAIResumeFile({
    download_url: 'https://files.oaiusercontent.com/private/resume.doc?signature=redacted',
    file_id: 'file_resume_123',
    mime_type: 'application/msword',
    file_name: 'resume.doc',
  }, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error')
      assert.match(options.headers.Accept, /application\/msword/)
      return new Response(doc, { status: 200, headers: { 'content-type': 'application/msword' } })
    },
  })
  assert.equal(downloaded.originalname, 'resume.doc')
  assert.equal(downloaded.mimetype, 'application/msword')
  assert.deepEqual(downloaded.buffer, doc)

  await assert.rejects(
    downloadOpenAIResumeFile({
      download_url: 'https://files.oaiusercontent.com/resume.pdf',
      file_id: 'file_resume_123',
    }, {
      fetchImpl: async () => new Response('small', {
        status: 200,
        headers: { 'content-length': String(25 * 1024 * 1024 + 1) },
      }),
    }),
    /25MB or smaller/,
  )
})
