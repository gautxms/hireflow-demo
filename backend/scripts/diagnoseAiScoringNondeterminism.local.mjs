#!/usr/bin/env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { analyzeResumeWithConfiguredFallback } from '../src/services/aiResumeAnalysisService.js'
import {
  buildResumeTextFingerprint,
  prepareResumePayloadForAnalysis,
} from '../src/services/resumeDocumentExtractionService.js'

const DEFAULT_RUN_COUNT = 10
const MAX_RUN_COUNT = 10
const OPT_IN_ENV = 'ENABLE_LOCAL_AI_SCORING_DIAGNOSTICS'
const SYNTHETIC_FILENAME = 'synthetic-local-ai-scoring-diagnostic.txt'
const QUIET_LOGGER = { debug() {}, info() {}, warn() {}, log() {}, error() {} }

export const SYNTHETIC_AI_SCORING_RESUME_TEXT = [
  'Synthetic Profile Delta',
  'Summary: backend engineer for workflow automation and recruiting operations.',
  'Skills: Node.js, PostgreSQL, Redis, AWS, accessibility, observability.',
  'Experience: Staff Software Engineer, Example Systems, 2022-2026.',
  'Experience: Senior Software Engineer, Sample Platforms, 2018-2022.',
  'Education: B.S. Computer Science, Synthetic State University.',
].join('\n')

export const SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT = Object.freeze({
  hasContext: true,
  jobDescriptionId: 'synthetic-local-diagnostic-jd',
  title: 'Synthetic Backend Engineer',
  description: 'Build reliable backend services and workflow automation.',
  requirements: 'Node.js or Java, PostgreSQL, REST APIs, testing, observability.',
  skills: ['Node.js', 'Java', 'PostgreSQL', 'REST APIs', 'Testing', 'Observability'],
  experienceYears: '3-6',
  location: 'Remote',
  source: 'synthetic_local_diagnostic',
})

export function isDirectExecution() {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveRunCount(value) {
  const runCount = parsePositiveInteger(value, DEFAULT_RUN_COUNT)
  if (runCount > MAX_RUN_COUNT) {
    throw new Error('run_count_exceeds_maximum_10')
  }
  return runCount
}

export function assertAiScoringDiagnosticsOptIn(env = process.env) {
  if (String(env?.[OPT_IN_ENV] || '').toLowerCase() !== 'true') {
    throw new Error('local_ai_scoring_diagnostics_opt_in_required')
  }
}

export function assertSingleProviderAttemptForNondeterminismMode(env = process.env) {
  if (String(env?.AI_MAX_PROVIDER_ATTEMPTS_PER_FILE || '').trim() !== '1') {
    throw new Error('single_provider_attempt_required_for_nondeterminism_mode')
  }
}

function numericOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeScore(candidate = {}) {
  return numericOrNull(candidate?.score ?? candidate?.profile_score ?? candidate?.matchScore?.score ?? candidate?.matchScore?.score_out_of_ten)
}

function summarizeRun({ runNumber, preparedInputFingerprint, response }) {
  const candidates = Array.isArray(response?.result?.candidates) ? response.result.candidates : []
  const candidate = candidates[0] || {}
  const attempts = Array.isArray(response?.attempts) ? response.attempts : []
  const successfulAttempt = [...attempts].reverse().find((attempt) => attempt?.success) || attempts[attempts.length - 1] || null
  const tokenUsage = response?.tokenUsage && typeof response.tokenUsage === 'object'
    ? response.tokenUsage
    : successfulAttempt?.tokenUsage || null

  return {
    runNumber,
    preparedInputFingerprint,
    score: normalizeScore(candidate),
    profileScore: numericOrNull(candidate?.profile_score),
    fitAssessmentOverallScore: numericOrNull(candidate?.fit_assessment?.overall_fit_score ?? candidate?.fitAssessment?.overallFitScore),
    matchScore: numericOrNull(candidate?.matchScore?.score ?? candidate?.matchScore?.score_out_of_ten),
    yearsExperience: numericOrNull(candidate?.years_experience),
    verdict: candidate?.verdict || candidate?.matchScore?.fit || null,
    selectedProvider: response?.provider || successfulAttempt?.provider || null,
    selectedModel: response?.model || successfulAttempt?.model || null,
    promptVersion: response?.promptVersion ?? successfulAttempt?.promptVersion ?? null,
    compactMode: response?.mode || successfulAttempt?.mode || null,
    retryAttemptCount: attempts.length > 0 ? Math.max(0, attempts.length - 1) : null,
    inputTokens: tokenUsage?.inputTokens ?? null,
    outputTokens: tokenUsage?.outputTokens ?? null,
    totalTokens: tokenUsage?.totalTokens ?? null,
    failureCategory: successfulAttempt?.failureCategory || null,
  }
}

function allStable(values = []) {
  const present = values.map((value) => value ?? null)
  return new Set(present.map((value) => JSON.stringify(value))).size <= 1
}

export function calculateAiScoringVariance(runs = []) {
  const scores = runs.map((run) => numericOrNull(run.score)).filter((score) => score !== null)
  const scoreSum = scores.reduce((sum, score) => sum + score, 0)
  const yearsExperienceValues = runs.map((run) => numericOrNull(run.yearsExperience)).filter((years) => years !== null)
  const providerModels = runs.map((run) => [run.selectedProvider, run.selectedModel])

  return {
    runCount: runs.length,
    minimumScore: scores.length ? Math.min(...scores) : null,
    maximumScore: scores.length ? Math.max(...scores) : null,
    scoreRange: scores.length ? Math.max(...scores) - Math.min(...scores) : null,
    scoreSpread: scores.length ? Math.max(...scores) - Math.min(...scores) : null,
    averageScore: scores.length ? Number((scoreSum / scores.length).toFixed(4)) : null,
    distinctScoreCount: new Set(scores).size,
    yearsExperienceDistinctValues: [...new Set(yearsExperienceValues)].sort((a, b) => a - b),
    yearsExperienceDistinctCount: new Set(yearsExperienceValues).size,
    identicalPreparedInputFingerprintAcrossRuns: allStable(runs.map((run) => run.preparedInputFingerprint)),
    providerModelStableAcrossRuns: allStable(providerModels),
    promptVersionStableAcrossRuns: allStable(runs.map((run) => run.promptVersion)),
    compactModeStableAcrossRuns: allStable(runs.map((run) => run.compactMode)),
    retryCountStableAcrossRuns: allStable(runs.map((run) => run.retryAttemptCount)),
  }
}

async function withSuppressedProviderConsole(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug }
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
  console.info = () => {}
  console.debug = () => {}
  try {
    return await fn()
  } finally {
    console.log = original.log
    console.warn = original.warn
    console.error = original.error
    console.info = original.info
    console.debug = original.debug
  }
}

export async function runAiScoringNondeterminismDiagnostics({
  runCount = DEFAULT_RUN_COUNT,
  env = process.env,
  credentials,
  systemPromptConfig,
  jobDescriptionContext = SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT,
  analyzeWithAnthropic,
  analyzeWithOpenAI,
} = {}) {
  assertAiScoringDiagnosticsOptIn(env)
  assertSingleProviderAttemptForNondeterminismMode(env)
  const resolvedRunCount = resolveRunCount(runCount)
  const resolvedJobDescriptionContext = jobDescriptionContext || SYNTHETIC_LOCAL_DIAGNOSTIC_JD_CONTEXT
  const preparedPayload = await prepareResumePayloadForAnalysis({
    fileBufferBase64: Buffer.from(SYNTHETIC_AI_SCORING_RESUME_TEXT, 'utf8').toString('base64'),
    mimeType: 'text/plain',
    originalMimeType: 'text/plain',
    filename: SYNTHETIC_FILENAME,
    fileSize: Buffer.byteLength(SYNTHETIC_AI_SCORING_RESUME_TEXT, 'utf8'),
    logger: QUIET_LOGGER,
    diagnosticsContext: {},
  })
  const preparedText = String(preparedPayload?.extractedText || SYNTHETIC_AI_SCORING_RESUME_TEXT)
  const preparedInputFingerprint = buildResumeTextFingerprint(preparedText).sha256
  const preparedBase64 = preparedPayload.fileBufferBase64
  const runs = []

  for (let index = 0; index < resolvedRunCount; index += 1) {
    const response = await withSuppressedProviderConsole(() => analyzeResumeWithConfiguredFallback(
      preparedBase64,
      'text/plain',
      SYNTHETIC_FILENAME,
      {
        credentials,
        systemPromptConfig,
        jobDescriptionContext: resolvedJobDescriptionContext,
        analyzeWithAnthropic,
        analyzeWithOpenAI,
      },
    ))
    runs.push(summarizeRun({ runNumber: index + 1, preparedInputFingerprint, response }))
  }

  return {
    diagnostic: 'ai_scoring_nondeterminism_local_staging_only',
    localStagingOnly: true,
    note: 'Safe aggregate diagnostics only; raw resume text, synthetic JD text, and provider response bodies are intentionally omitted. Requires AI_MAX_PROVIDER_ATTEMPTS_PER_FILE=1 to isolate one provider attempt.',
    runs,
    variance: calculateAiScoringVariance(runs),
  }
}

function parseArgs(argv = []) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runs') values.runCount = argv[++index]
  }
  return values
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    const report = await runAiScoringNondeterminismDiagnostics({ runCount: args.runCount ?? DEFAULT_RUN_COUNT })
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error(JSON.stringify({
      diagnostic: 'ai_scoring_nondeterminism_local_staging_only',
      localStagingOnly: true,
      error: [
        'local_ai_scoring_diagnostics_opt_in_required',
        'single_provider_attempt_required_for_nondeterminism_mode',
        'run_count_exceeds_maximum_10',
      ].includes(error?.message)
        ? error.message
        : 'diagnostic_failed',
    }))
    process.exitCode = 1
  }
}

if (isDirectExecution()) {
  await main()
}
