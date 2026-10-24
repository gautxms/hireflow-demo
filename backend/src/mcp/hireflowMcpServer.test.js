import test from 'node:test'
import assert from 'node:assert/strict'
import { downloadOpenAIFile, HIRE_FLOW_MCP_TOOLS } from './hireflowMcpServer.js'

test('MCP tool catalog exposes profile, native file input, and confirmed creation contracts', () => {
  assert.deepEqual(HIRE_FLOW_MCP_TOOLS.map((tool) => tool.name), [
    'get_current_profile',
    'preview_job_description',
    'create_job_from_preview',
  ])

  const profile = HIRE_FLOW_MCP_TOOLS[0]
  assert.equal(profile.annotations.readOnlyHint, true)
  assert.equal(profile._meta['openai/profile'], true)
  assert.deepEqual(profile.securitySchemes, [{ type: 'oauth2', scopes: ['mcp:profile'] }])

  const preview = HIRE_FLOW_MCP_TOOLS[1]
  assert.deepEqual(preview._meta['openai/fileParams'], ['file'])
  const fileDefinition = preview.inputSchema.properties.file
  assert.deepEqual(fileDefinition.required, ['download_url', 'file_id'])
  assert.ok(fileDefinition.properties.mime_type)
  assert.ok(fileDefinition.properties.file_name)
  assert.equal(preview.annotations.readOnlyHint, false)
  assert.deepEqual(preview.securitySchemes, [{ type: 'oauth2', scopes: ['mcp:profile', 'jobs:write'] }])

  const create = HIRE_FLOW_MCP_TOOLS[2]
  assert.deepEqual(create.inputSchema.properties.confirmed.const, true)
  assert.ok(create.inputSchema.required.includes('confirmed'))
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
