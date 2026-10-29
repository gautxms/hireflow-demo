import path from 'node:path'
import { Server } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { pool } from '../db/client.js'
import {
  confirmStatelessJobDescriptionCreation,
  prepareStatelessJobDescriptionCreation,
} from '../services/jobDescriptionConfirmedCreationService.js'
import { MAX_JD_PREVIEW_FILE_BYTES } from '../services/jobDescriptionPreviewService.js'
import {
  createResumeAnalysis,
  MAX_RESUME_ANALYSIS_FILE_BYTES,
  MAX_RESUME_ANALYSIS_FILES,
} from '../services/resumeAnalysisCreationService.js'
import {
  assertMcpPaidMutationAccess,
  buildMcpAuthChallenge,
  getMcpOAuthConfig,
  McpOAuthError,
  MCP_SCOPES,
  readBearerToken,
  verifyMcpAccessToken,
} from '../services/mcpOAuthService.js'
import {
  getMcpAnalysisResults,
  getMcpAnalysisStatus,
  getMcpResumeQuota,
  listMcpJobs,
} from '../services/mcpHireFlowReadService.js'

const PDF_MIME = 'application/pdf'
const DOC_MIME = 'application/msword'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TXT_MIME = 'text/plain'
const DEFAULT_FILE_HOST_SUFFIXES = ['.oaiusercontent.com', '.blob.core.windows.net', '.amazonaws.com']
const SAFE_JOB_ERROR_NAMES = new Set([
  'JobDescriptionConfirmedCreationError',
  'JobDescriptionFileStorageError',
  'JobDescriptionPreviewError',
  'JobDescriptionPreviewReceiptError',
  'JobDescriptionValidationError',
  'McpFileInputError',
  'ResumeAnalysisCreationError',
])

class McpFileInputError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'McpFileInputError'
    this.code = code
  }
}

const OpenAIFileSchema = z.object({
  download_url: z.url(),
  file_id: z.string().min(1).max(500),
  mime_type: z.string().max(200).optional(),
  file_name: z.string().max(500).optional(),
}).strict()

const PreviewInputSchema = z.object({ file: OpenAIFileSchema }).strict()
const JobFieldsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(30_000).optional().nullable(),
  responsibilities: z.string().max(8_000).optional().nullable(),
  requirements: z.string().max(8_000).optional().nullable(),
  skills: z.array(z.string().max(80)).max(30).optional(),
  location: z.string().max(250).optional().nullable(),
  experienceMin: z.number().int().min(0).max(80).optional().nullable(),
  experienceMax: z.number().int().min(0).max(80).optional().nullable(),
  workMode: z.enum(['remote', 'hybrid', 'onsite']).optional().nullable(),
  department: z.string().max(200).optional(),
  additionalInfo: z.string().max(2_000).optional().nullable(),
  status: z.enum(['draft', 'active']).optional(),
}).strict()
const CreateInputSchema = z.object({
  previewToken: z.string().min(1).max(20_000),
  file: OpenAIFileSchema,
  fields: JobFieldsSchema,
}).strict()
const CreateAnalysisInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  jobDescriptionId: z.uuid().optional().nullable(),
  files: z.array(OpenAIFileSchema).min(1).max(MAX_RESUME_ANALYSIS_FILES),
}).strict()
const ListJobsInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict()
const AnalysisStatusInputSchema = z.object({ analysisId: z.uuid() }).strict()

const ProfileOutputSchema = z.object({
  id: z.string().min(1).regex(/\S/),
  name: z.string().optional(),
  email: z.string().optional(),
  nickname: z.string().optional(),
}).strict()

const PreviewOutputSchema = z.object({
  fields: JobFieldsSchema,
  warnings: z.array(z.string()),
  previewToken: z.string(),
  previewExpiresAt: z.string(),
  sourceFile: z.object({ name: z.string(), sha256: z.string() }).strict(),
}).strict()

const CreateOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  created: z.boolean(),
  sourceFile: z.object({ name: z.string(), sha256: z.string() }).strict(),
  url: z.url(),
}).strict()
const CreateAnalysisOutputSchema = z.object({
  analysisId: z.string(),
  name: z.string(),
  status: z.enum(['processing', 'failed']),
  jobDescriptionId: z.string().nullable(),
  queued: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  files: z.array(z.object({
    name: z.string(),
    status: z.enum(['queued', 'failed']),
    reason: z.string().optional(),
    resumeId: z.string().optional(),
    parseJobId: z.string().optional(),
  }).strict()),
  url: z.url(),
}).strict()
const JobsOutputSchema = z.object({
  jobs: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    department: z.string().nullable(),
    location: z.string().nullable(),
    updatedAt: z.string(),
  }).strict()),
}).strict()
const ResumeQuotaOutputSchema = z.object({
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  canCreateAnalysis: z.boolean(),
  periodStart: z.string(),
  periodEnd: z.string(),
}).strict()
const AnalysisStatusOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  job: z.object({ id: z.string(), title: z.string() }).strict().nullable(),
  counts: z.object({
    total: z.number().int().nonnegative(),
    complete: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
  }).strict(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  url: z.url(),
}).strict()
const CandidateBreakdownOutputSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
}).strict()
const AnalysisCandidateOutputSchema = z.object({
  id: z.string(),
  resumeId: z.string(),
  filename: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  location: z.string().nullable(),
  yearsExperience: z.number().nullable(),
  seniorityLevel: z.string().nullable(),
  score: z.number().min(0).max(100).nullable(),
  scoreOutOfTen: z.number().min(0).max(10).nullable(),
  verdict: z.string().nullable(),
  summary: z.string().nullable(),
  reason: z.string().nullable(),
  recommendation: z.string().nullable(),
  strengths: z.array(z.string()),
  considerations: z.array(z.string()),
  matchedRequirements: z.array(z.string()),
  missingRequirements: z.array(z.string()),
  risksOrGaps: z.array(z.string()),
  skills: z.array(z.string()),
  experienceHighlights: z.array(z.string()),
  breakdown: z.array(CandidateBreakdownOutputSchema),
  analysisMode: z.string().nullable(),
}).strict()
const AnalysisResultsOutputSchema = z.object({
  analysisId: z.string(),
  name: z.string(),
  status: z.string(),
  job: z.object({ id: z.string(), title: z.string() }).strict().nullable(),
  counts: AnalysisStatusOutputSchema.shape.counts,
  candidates: z.array(AnalysisCandidateOutputSchema),
  failures: z.array(z.object({ filename: z.string(), reason: z.string() }).strict()),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  url: z.url(),
}).strict()

const JOB_TOOL_SCOPES = [MCP_SCOPES.PROFILE, MCP_SCOPES.JOBS_WRITE]
const ANALYSIS_TOOL_SCOPES = [MCP_SCOPES.PROFILE, MCP_SCOPES.ANALYSES_WRITE]

function jsonSchema(schema) {
  return z.toJSONSchema(schema)
}

function oauthSchemes(scopes) {
  return [{ type: 'oauth2', scopes }]
}

function toolMeta(scopes, extra = {}) {
  return { securitySchemes: oauthSchemes(scopes), ...extra }
}

export const HIRE_FLOW_MCP_TOOLS = [
  {
    name: 'get_current_profile',
    title: 'Get current HireFlow profile',
    description: 'Return the HireFlow profile represented by the connected account.',
    inputSchema: jsonSchema(z.object({}).strict()),
    outputSchema: jsonSchema(ProfileOutputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: oauthSchemes([MCP_SCOPES.PROFILE]),
    _meta: toolMeta([MCP_SCOPES.PROFILE], { 'openai/profile': true }),
  },
  {
    name: 'list_jobs',
    title: 'Find HireFlow jobs',
    description: 'List or search the connected HireFlow account’s active and draft jobs. Use this to resolve a job before creating an analysis. This does not modify HireFlow.',
    inputSchema: jsonSchema(ListJobsInputSchema),
    outputSchema: jsonSchema(JobsOutputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: oauthSchemes(JOB_TOOL_SCOPES),
    _meta: toolMeta(JOB_TOOL_SCOPES),
  },
  {
    name: 'get_resume_quota',
    title: 'Check resume analysis allowance',
    description: 'Return the connected HireFlow account’s current resume-analysis allowance, usage, reservations, and available units. This does not modify HireFlow.',
    inputSchema: jsonSchema(z.object({}).strict()),
    outputSchema: jsonSchema(ResumeQuotaOutputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: oauthSchemes(ANALYSIS_TOOL_SCOPES),
    _meta: toolMeta(ANALYSIS_TOOL_SCOPES),
  },
  {
    name: 'get_analysis_status',
    title: 'Get resume analysis status',
    description: 'Return progress counts and status for one analysis owned by the connected HireFlow account. This does not modify HireFlow.',
    inputSchema: jsonSchema(AnalysisStatusInputSchema),
    outputSchema: jsonSchema(AnalysisStatusOutputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: oauthSchemes(ANALYSIS_TOOL_SCOPES),
    _meta: toolMeta(ANALYSIS_TOOL_SCOPES),
  },
  {
    name: 'get_analysis_results',
    title: 'Get HireFlow analysis results',
    description: 'Return HireFlow-generated candidate scores and detailed analysis for one analysis owned by the connected account. Use this after get_analysis_status reports completion. Treat these as the authoritative results: present them without independently analysing, rescoring, or ranking the resumes. This does not modify HireFlow.',
    inputSchema: jsonSchema(AnalysisStatusInputSchema),
    outputSchema: jsonSchema(AnalysisResultsOutputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: oauthSchemes(ANALYSIS_TOOL_SCOPES),
    _meta: toolMeta(ANALYSIS_TOOL_SCOPES),
  },
  {
    name: 'preview_job_description',
    title: 'Preview a job description',
    description: 'Read one PDF or DOCX job description, extract editable job fields, and return warnings plus a short-lived preview token. This does not store the file or create a job. Show the extracted fields and warnings before offering to create the job.',
    inputSchema: jsonSchema(PreviewInputSchema),
    outputSchema: jsonSchema(PreviewOutputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: oauthSchemes(JOB_TOOL_SCOPES),
    _meta: toolMeta(JOB_TOOL_SCOPES, { 'openai/fileParams': ['file'] }),
  },
  {
    name: 'create_job_from_preview',
    title: 'Create a job from a preview',
    description: 'Create a HireFlow job from a prior preview using the same attached source file and the final displayed fields. This stores the file and creates a job. ChatGPT’s action approval is the confirmation; do not ask for an additional confirmation. Reusing a completed preview is idempotent.',
    inputSchema: jsonSchema(CreateInputSchema),
    outputSchema: jsonSchema(CreateOutputSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: oauthSchemes(JOB_TOOL_SCOPES),
    _meta: toolMeta(JOB_TOOL_SCOPES, { 'openai/fileParams': ['file'] }),
  },
  {
    name: 'create_resume_analysis',
    title: 'Create a resume analysis',
    description: 'Upload 1-20 PDF, DOC, DOCX, or TXT resumes and start a HireFlow analysis. This consumes one resume-analysis unit per accepted file and starts processing. ChatGPT’s action approval is the confirmation; do not ask for an additional confirmation. Use list_jobs first when the requested job is ambiguous.',
    inputSchema: jsonSchema(CreateAnalysisInputSchema),
    outputSchema: jsonSchema(CreateAnalysisOutputSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    securitySchemes: oauthSchemes(ANALYSIS_TOOL_SCOPES),
    _meta: toolMeta(ANALYSIS_TOOL_SCOPES, { 'openai/fileParams': ['files'] }),
  },
]

function allowedFileHost(hostname, env = process.env) {
  const configured = String(env.MCP_FILE_DOWNLOAD_HOSTS || '')
    .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  const suffixes = configured.length ? configured : DEFAULT_FILE_HOST_SUFFIXES
  const host = hostname.toLowerCase()
  return suffixes.some((suffix) => host === suffix.replace(/^\./, '') || host.endsWith(suffix.startsWith('.') ? suffix : `.${suffix}`))
}

async function readLimitedResponseBody(response, {
  maxBytes = MAX_JD_PREVIEW_FILE_BYTES,
  tooLargeCode = 'JD_FILE_TOO_LARGE',
  tooLargeMessage = 'JD file must be 20MB or smaller.',
  downloadFailedCode = 'JD_FILE_DOWNLOAD_FAILED',
} = {}) {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > maxBytes) {
    throw new McpFileInputError(tooLargeCode, tooLargeMessage)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new McpFileInputError(downloadFailedCode, 'The uploaded file could not be downloaded.')
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new McpFileInputError(tooLargeCode, tooLargeMessage)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

export async function downloadOpenAIFile(file, { env = process.env, fetchImpl = fetch } = {}) {
  const url = new URL(file.download_url)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedFileHost(url.hostname, env)) {
    throw new McpFileInputError('JD_FILE_HOST_NOT_ALLOWED', 'The file download URL is not from an approved ChatGPT file host.')
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: `${PDF_MIME}, ${DOCX_MIME}` },
  })
  if (!response.ok) {
    throw new McpFileInputError('JD_FILE_DOWNLOAD_FAILED', 'The uploaded file could not be downloaded. Please attach it again.')
  }

  const buffer = await readLimitedResponseBody(response)
  const responseType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const mimeType = String(file.mime_type || responseType).trim().toLowerCase()
  const fallbackExtension = mimeType === DOCX_MIME ? '.docx' : '.pdf'
  const urlName = path.basename(decodeURIComponent(url.pathname || ''))
  const originalname = String(file.file_name || urlName || `${file.file_id}${fallbackExtension}`)

  return { originalname, mimetype: mimeType, buffer }
}

export async function downloadOpenAIResumeFile(file, { env = process.env, fetchImpl = fetch } = {}) {
  const url = new URL(file.download_url)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedFileHost(url.hostname, env)) {
    throw new McpFileInputError('RESUME_FILE_HOST_NOT_ALLOWED', 'The resume download URL is not from an approved ChatGPT file host.')
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: `${PDF_MIME}, ${DOC_MIME}, ${DOCX_MIME}, ${TXT_MIME}` },
  })
  if (!response.ok) {
    throw new McpFileInputError('RESUME_FILE_DOWNLOAD_FAILED', 'A resume could not be downloaded. Please attach it again.')
  }

  const buffer = await readLimitedResponseBody(response, {
    maxBytes: MAX_RESUME_ANALYSIS_FILE_BYTES,
    tooLargeCode: 'RESUME_FILE_TOO_LARGE',
    tooLargeMessage: 'Each resume must be 25MB or smaller.',
    downloadFailedCode: 'RESUME_FILE_DOWNLOAD_FAILED',
  })
  const responseType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const mimeType = String(file.mime_type || responseType).trim().toLowerCase()
  const extensionByType = {
    [DOC_MIME]: '.doc',
    [DOCX_MIME]: '.docx',
    [TXT_MIME]: '.txt',
  }
  const fallbackExtension = extensionByType[mimeType] || '.pdf'
  const urlName = path.basename(decodeURIComponent(url.pathname || ''))
  const originalname = String(file.file_name || urlName || `${file.file_id}${fallbackExtension}`)

  return { originalname, mimetype: mimeType, buffer }
}

function jsonResult(structuredContent, text = JSON.stringify(structuredContent)) {
  return {
    isError: false,
    structuredContent,
    content: [{ type: 'text', text }],
  }
}

function toolError(error, { env = process.env, requiredScopes = [] } = {}) {
  const isSafeError = error instanceof McpOAuthError || SAFE_JOB_ERROR_NAMES.has(error?.name)
  const code = isSafeError ? (error?.code || error?.name) : 'HIREFLOW_TOOL_FAILED'
  const message = isSafeError ? error.message : 'HireFlow could not complete this request. Please try again.'
  if (!isSafeError) {
    console.error('[MCP] Tool execution failed:', { name: error?.name, code: error?.code })
  }
  const result = {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
  }

  if (error instanceof McpOAuthError && ['invalid_token', 'insufficient_scope'].includes(error.code)) {
    result._meta = {
      'mcp/www_authenticate': [buildMcpAuthChallenge({
        env,
        error: error.code,
        description: message,
        scope: requiredScopes.join(' '),
      })],
    }
  }
  return result
}

async function authorizeAndRun({ authorizationHeader, requiredScopes, db, env, action }) {
  try {
    const auth = await verifyMcpAccessToken({
      db,
      token: readBearerToken(authorizationHeader),
      requiredScopes,
      env,
    })
    return await action(auth)
  } catch (error) {
    return toolError(error, { env, requiredScopes })
  }
}

function validationError(parsed) {
  return {
    isError: true,
    content: [{ type: 'text', text: `INVALID_TOOL_INPUT: ${z.prettifyError(parsed.error)}` }],
  }
}

export function createHireFlowMcpServer({
  authorizationHeader,
  db = pool,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const server = new Server(
    { name: 'hireflow', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: 'Use read-only tools without requesting extra confirmation. To create a job, call preview_job_description first and show every extracted field and warning, then offer create_job_from_preview; ChatGPT’s action approval is the confirmation. For analyses, use list_jobs when the job is ambiguous and get_resume_quota when allowance matters, then call create_resume_analysis directly from the user’s creation request; do not add a duplicate conversational confirmation. After processing completes, call get_analysis_results and present HireFlow’s scores and analysis. All resume scores, rankings, recommendations, strengths, concerns, and evidence must come exclusively from HireFlow tool results. Never inspect attached resumes to produce a preliminary, fallback, or independent analysis. If HireFlow analysis creation or result retrieval is unavailable or fails, report that failure and stop. Never invent missing job details. Each call is scoped to the connected HireFlow profile.',
    },
  )

  server.setRequestHandler('tools/list', async () => ({ tools: HIRE_FLOW_MCP_TOOLS }))
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params || {}

    if (name === 'get_current_profile') {
      const parsed = z.object({}).strict().safeParse(args || {})
      if (!parsed.success) return validationError(parsed)
      return authorizeAndRun({
        authorizationHeader,
        requiredScopes: [MCP_SCOPES.PROFILE],
        db,
        env,
        action: async (auth) => {
          const profile = {
            id: auth.user.profileId,
            ...(auth.user.company ? { name: auth.user.company } : {}),
            ...(auth.user.email ? { email: auth.user.email } : {}),
            ...(auth.user.company ? { nickname: auth.user.company } : {}),
          }
          return jsonResult(profile)
        },
      })
    }

    if (name === 'list_jobs') {
      const parsed = ListJobsInputSchema.safeParse(args || {})
      if (!parsed.success) return validationError(parsed)
      return authorizeAndRun({
        authorizationHeader,
        requiredScopes: JOB_TOOL_SCOPES,
        db,
        env,
        action: async (auth) => jsonResult(await listMcpJobs({
          db,
          userId: auth.userId,
          query: parsed.data.query,
          limit: parsed.data.limit,
        })),
      })
    }

    if (name === 'get_resume_quota') {
      const parsed = z.object({}).strict().safeParse(args || {})
      if (!parsed.success) return validationError(parsed)
      return authorizeAndRun({
        authorizationHeader,
        requiredScopes: ANALYSIS_TOOL_SCOPES,
        db,
        env,
        action: async (auth) => {
          const quota = await getMcpResumeQuota({ db, userId: auth.userId, env })
          if (!quota) return { isError: true, content: [{ type: 'text', text: 'HIREFLOW_PROFILE_NOT_FOUND: The connected HireFlow profile was not found.' }] }
          return jsonResult(quota)
        },
      })
    }

    if (name === 'get_analysis_status') {
      const parsed = AnalysisStatusInputSchema.safeParse(args)
      if (!parsed.success) return validationError(parsed)
      return authorizeAndRun({
        authorizationHeader,
        requiredScopes: ANALYSIS_TOOL_SCOPES,
        db,
        env,
        action: async (auth) => {
          const status = await getMcpAnalysisStatus({
            db,
            userId: auth.userId,
            analysisId: parsed.data.analysisId,
          })
          if (!status) return { isError: true, content: [{ type: 'text', text: 'ANALYSIS_NOT_FOUND: This analysis was not found for the connected HireFlow account.' }] }
          const output = {
            ...status,
            url: `${getMcpOAuthConfig(env).issuer}/analyses/${encodeURIComponent(status.id)}`,
          }
          return jsonResult(output)
        },
      })
    }

    if (name === 'get_analysis_results') {
      const parsed = AnalysisStatusInputSchema.safeParse(args)
      if (!parsed.success) return validationError(parsed)
      return authorizeAndRun({
        authorizationHeader,
        requiredScopes: ANALYSIS_TOOL_SCOPES,
        db,
        env,
        action: async (auth) => {
          const results = await getMcpAnalysisResults({
            db,
            userId: auth.userId,
            analysisId: parsed.data.analysisId,
          })
          if (!results) return { isError: true, content: [{ type: 'text', text: 'ANALYSIS_NOT_FOUND: This analysis was not found for the connected HireFlow account.' }] }
          const output = {
            ...results,
            url: `${getMcpOAuthConfig(env).issuer}/analyses/${encodeURIComponent(results.analysisId)}`,
          }
          return jsonResult(
            output,
            `HireFlow analysis “${output.name}” is ${output.status} with ${output.candidates.length} candidate result${output.candidates.length === 1 ? '' : 's'}. Present only these HireFlow-generated results; do not add independent resume analysis.`,
          )
        },
      })
    }

    if (name === 'preview_job_description') {
      const parsed = PreviewInputSchema.safeParse(args)
      if (!parsed.success) return validationError(parsed)
      return authorizeAndRun({
        authorizationHeader,
        requiredScopes: JOB_TOOL_SCOPES,
        db,
        env,
        action: async (auth) => {
          assertMcpPaidMutationAccess(auth)
          const downloadedFile = await downloadOpenAIFile(parsed.data.file, { env, fetchImpl })
          const preview = await prepareStatelessJobDescriptionCreation({ userId: auth.userId, file: downloadedFile })
          const output = {
            ...preview,
            previewExpiresAt: new Date(preview.previewExpiresAt).toISOString(),
          }
          return jsonResult(output, `Extracted job description fields from ${preview.sourceFile.name}. Show the fields and warnings; the native action approval will confirm creation.`)
        },
      })
    }

    if (name === 'create_job_from_preview') {
      const parsed = CreateInputSchema.safeParse(args)
      if (!parsed.success) return validationError(parsed)
      return authorizeAndRun({
        authorizationHeader,
        requiredScopes: JOB_TOOL_SCOPES,
        db,
        env,
        action: async (auth) => {
          assertMcpPaidMutationAccess(auth)
          const downloadedFile = await downloadOpenAIFile(parsed.data.file, { env, fetchImpl })
          const confirmed = await confirmStatelessJobDescriptionCreation({
            db,
            userId: auth.userId,
            file: downloadedFile,
            input: parsed.data.fields,
            previewToken: parsed.data.previewToken,
          })
          const output = {
            id: String(confirmed.job.id),
            title: confirmed.job.title,
            status: confirmed.job.status,
            created: confirmed.created,
            sourceFile: confirmed.sourceFile,
            url: `${getMcpOAuthConfig(env).issuer}/job-descriptions`,
          }
          return jsonResult(output, confirmed.created
            ? `Created HireFlow job “${confirmed.job.title}”.`
            : `This preview had already created HireFlow job “${confirmed.job.title}”; no duplicate was created.`)
        },
      })
    }

    if (name === 'create_resume_analysis') {
      const parsed = CreateAnalysisInputSchema.safeParse(args)
      if (!parsed.success) return validationError(parsed)
      return authorizeAndRun({
        authorizationHeader,
        requiredScopes: ANALYSIS_TOOL_SCOPES,
        db,
        env,
        action: async (auth) => {
          assertMcpPaidMutationAccess(auth)
          const files = await Promise.all(parsed.data.files.map((file) => (
            downloadOpenAIResumeFile(file, { env, fetchImpl })
          )))
          const analysis = await createResumeAnalysis({
            db,
            userId: auth.userId,
            files,
            analysisName: parsed.data.name,
            jobDescriptionId: parsed.data.jobDescriptionId || null,
            env,
          })
          const output = {
            ...analysis,
            url: `${getMcpOAuthConfig(env).issuer}/analyses/${encodeURIComponent(analysis.analysisId)}`,
          }
          return jsonResult(
            output,
            output.queued > 0
              ? `Created HireFlow analysis “${output.name}” and queued ${output.queued} resume${output.queued === 1 ? '' : 's'} for processing.`
              : `Created HireFlow analysis “${output.name}”, but none of the attached resumes passed validation or scanning.`,
          )
        },
      })
    }

    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${String(name || '')}` }] }
  })

  return server
}
