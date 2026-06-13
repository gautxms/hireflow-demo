#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_RESUME_TEXT_PROMPT_CHAR_LIMIT,
  cleanExtractedTextForPrompt,
} from '../src/services/aiResumeAnalysisService.js'
import {
  buildResumeTextFingerprint,
  normalizeResumeTextForFingerprint,
  prepareResumePayloadForAnalysis,
} from '../src/services/resumeDocumentExtractionService.js'
import {
  PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_EXTRACTION_METHOD,
  extractPdfCanonicalTextForInternalUse,
} from '../src/services/pdfCanonicalExtractionService.js'
import { LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_EXTRACTION_METHOD } from '../src/services/legacyDocSemanticExtractionService.js'
import { calculateSafeTextQualityMetrics } from '../src/services/resumeFormatDiagnosticHarness.js'

const DOC_MIME_TYPE = 'application/msword'
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const QUIET_LOGGER = { debug() {}, info() {}, warn() {}, log() {}, error() {} }
const FORMAT_LABELS = ['doc', 'docx', 'pdf']
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_PATTERN = /(?:\+?\d[\d().\-\s]{7,}\d)/g
const LOCAL_DIAGNOSTIC_USER_ID = 'local-diagnostic-user'
const LOCAL_DIAGNOSTIC_ANALYSIS_ID = 'local-diagnostic-analysis'
const LOCAL_DIAGNOSTIC_DOC_RESUME_ID = 'local-diagnostic-doc'

export function isDirectExecution() {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false
}

export function buildNamespacedSha256(value, namespace = 'resume-local-diagnostic-v1') {
  return createHash('sha256')
    .update(`${namespace}:`)
    .update(String(value ?? '').normalize('NFKC'))
    .digest('hex')
}

function hasPhone(value = '') {
  PHONE_PATTERN.lastIndex = 0
  const found = Array.from(String(value).matchAll(PHONE_PATTERN))
    .some((match) => String(match[0] || '').replace(/\D/g, '').length >= 10)
  PHONE_PATTERN.lastIndex = 0
  return found
}

function hasEmail(value = '') {
  EMAIL_PATTERN.lastIndex = 0
  const found = EMAIL_PATTERN.test(String(value || ''))
  EMAIL_PATTERN.lastIndex = 0
  return found
}

function normalizedLines(text = '') {
  const normalized = normalizeResumeTextForFingerprint(text)
  return normalized ? normalized.split('\n').filter(Boolean) : []
}

function fingerprintLines(lines = [], namespace) {
  return buildNamespacedSha256(JSON.stringify(lines), namespace)
}

function buildSafeStageMetrics(text = '') {
  const lines = normalizedLines(text)
  const orderedFingerprint = buildResumeTextFingerprint(text)
  const sortedLines = [...lines].sort()
  const uniqueLines = [...new Set(sortedLines)]
  const quality = calculateSafeTextQualityMetrics(text)

  return {
    normalizedCharCount: orderedFingerprint.normalizedCharCount || 0,
    normalizedLineCount: orderedFingerprint.normalizedLineCount || 0,
    orderedNormalizedFingerprint: orderedFingerprint.sha256 || null,
    sortedLineMultisetFingerprint: lines.length ? fingerprintLines(sortedLines, 'resume-local-diagnostic-sorted-line-multiset-v1') : null,
    uniqueLineSetFingerprint: uniqueLines.length ? fingerprintLines(uniqueLines, 'resume-local-diagnostic-unique-line-set-v1') : null,
    printableRatio: quality.printableRatio,
    suspiciousNoiseRatio: quality.suspiciousNoiseRatio,
    duplicateLineRatio: quality.duplicateLineRatio,
  }
}

export function buildSafeLineFingerprintSummary(text = '') {
  const lines = normalizedLines(text)
  const extractionStageMetrics = buildSafeStageMetrics(text)
  const promptReadyText = cleanExtractedTextForPrompt(text, { maxChars: DEFAULT_RESUME_TEXT_PROMPT_CHAR_LIMIT }).cleanedText
  const lineHashes = lines.map((line) => buildNamespacedSha256(line, 'resume-local-diagnostic-line-v1'))
  const uniqueLineHashes = new Set(lineHashes)
  const redactedLineCount = lines.filter((line) => hasEmail(line) || hasPhone(line)).length

  return {
    ...extractionStageMetrics,
    extractionStageMetrics,
    promptReadyStageMetrics: buildSafeStageMetrics(promptReadyText),
    lineHashSet: uniqueLineHashes,
    redactedLineCount,
  }
}

export function buildOnlyInFormatHashCounts(summariesByFormat = {}) {
  const counts = { onlyInDocLineHashCount: 0, onlyInDocxLineHashCount: 0, onlyInPdfLineHashCount: 0 }
  const mapping = [
    ['doc', 'onlyInDocLineHashCount'],
    ['docx', 'onlyInDocxLineHashCount'],
    ['pdf', 'onlyInPdfLineHashCount'],
  ]
  for (const [label, key] of mapping) {
    const own = summariesByFormat[label]?.lineHashSet || new Set()
    const others = new Set()
    for (const otherLabel of FORMAT_LABELS.filter((candidate) => candidate !== label)) {
      for (const hash of summariesByFormat[otherLabel]?.lineHashSet || []) others.add(hash)
    }
    counts[key] = [...own].filter((hash) => !others.has(hash)).length
  }
  return counts
}

export function buildSafeExtractionEquivalenceReport(extractions = []) {
  const summariesByFormat = {}
  for (const extraction of extractions) {
    summariesByFormat[extraction.formatLabel] = buildSafeLineFingerprintSummary(extraction.extractedText || '')
  }
  const onlyInCounts = buildOnlyInFormatHashCounts(summariesByFormat)

  return {
    diagnostic: 'resume_format_equivalence_local_staging_only',
    localStagingOnly: true,
    note: 'Safe aggregate diagnostics only; raw text, filenames, paths, and PII are intentionally omitted. Metrics are split into extractionStageMetrics and promptReadyStageMetrics.',
    formats: extractions.map((extraction) => {
      const summary = summariesByFormat[extraction.formatLabel] || buildSafeLineFingerprintSummary('')
      return {
        formatLabel: extraction.formatLabel,
        extractionMethod: extraction.extractionMethod || null,
        extractionStageMetrics: summary.extractionStageMetrics,
        promptReadyStageMetrics: summary.promptReadyStageMetrics,
        redactedLineCount: summary.redactedLineCount,
        ...onlyInCounts,
      }
    }),
    aggregateOnlyInFormatHashCounts: onlyInCounts,
  }
}

function semanticDocScoringFallbackReason(preparedPayload = {}) {
  const diagnostics = preparedPayload?.diagnostics || {}
  return diagnostics?.legacyDocSemanticTextScoringExperiment?.scoringFallbackReason || null
}

function createSemanticDocScoringNotSelectedError(preparedPayload = {}) {
  const error = new Error('semantic_doc_scoring_not_selected')
  error.category = 'semantic_doc_scoring_not_selected'
  error.selectedExtractionMethod = preparedPayload?.diagnostics?.extractionMethod || preparedPayload?.extractionMethod || null
  error.safeFallbackReason = semanticDocScoringFallbackReason(preparedPayload)
  return error
}

export function assertSemanticDocDiagnosticEnv(env = process.env) {
  const enabled = String(env.ENABLE_LEGACY_DOC_EXTRACTION || '').toLowerCase() === 'true'
  const semanticEnabled = String(env.LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED || '').toLowerCase() === 'true'
  const allowedUsers = String(env.LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (!enabled || !semanticEnabled || !allowedUsers.includes(LOCAL_DIAGNOSTIC_USER_ID)) {
    throw createSemanticDocScoringNotSelectedError({
      extractionMethod: null,
      diagnostics: { legacyDocSemanticTextScoringExperiment: { scoringFallbackReason: 'local_semantic_doc_env_not_configured' } },
    })
  }
}

async function readRequiredFixture(pathValue) {
  if (!pathValue) throw new Error('missing_required_fixture_path')
  try {
    const info = await stat(pathValue)
    if (!info.isFile()) throw new Error('not_file')
    return await readFile(pathValue)
  } catch {
    throw new Error('missing_required_fixture_path')
  }
}

async function extractViaPreparedPayload({ buffer, mimeType, syntheticFilename, diagnosticsContext = {} }) {
  const prepared = await prepareResumePayloadForAnalysis({
    fileBufferBase64: Buffer.from(buffer).toString('base64'),
    mimeType,
    originalMimeType: mimeType,
    filename: syntheticFilename,
    fileSize: buffer.length,
    logger: QUIET_LOGGER,
    diagnosticsContext,
  })
  return {
    extractedText: String(prepared?.extractedText || ''),
    extractionMethod: prepared?.diagnostics?.extractionMethod || prepared?.extractionMethod || null,
    preparedPayload: prepared,
  }
}

export async function runExtractionEquivalenceFromLocalFixtures({ docPath, docxPath, pdfPath, env = process.env } = {}) {
  assertSemanticDocDiagnosticEnv(env)
  const [docBuffer, docxBuffer, pdfBuffer] = await Promise.all([
    readRequiredFixture(docPath),
    readRequiredFixture(docxPath),
    readRequiredFixture(pdfPath),
  ])

  const [doc, docx, pdfCanonical] = await Promise.all([
    extractViaPreparedPayload({
      buffer: docBuffer,
      mimeType: DOC_MIME_TYPE,
      syntheticFilename: 'synthetic-local-diagnostic.doc',
      diagnosticsContext: {
        userId: LOCAL_DIAGNOSTIC_USER_ID,
        analysisId: LOCAL_DIAGNOSTIC_ANALYSIS_ID,
        resumeId: LOCAL_DIAGNOSTIC_DOC_RESUME_ID,
      },
    }),
    extractViaPreparedPayload({ buffer: docxBuffer, mimeType: DOCX_MIME_TYPE, syntheticFilename: 'synthetic-local-diagnostic.docx' }),
    extractPdfCanonicalTextForInternalUse(pdfBuffer),
  ])

  if (doc.extractionMethod !== LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_EXTRACTION_METHOD) {
    throw createSemanticDocScoringNotSelectedError(doc.preparedPayload)
  }

  return buildSafeExtractionEquivalenceReport([
    { formatLabel: 'doc', extractionMethod: doc.extractionMethod, extractedText: doc.extractedText },
    { formatLabel: 'docx', extractionMethod: docx.extractionMethod, extractedText: docx.extractedText },
    {
      formatLabel: 'pdf',
      extractionMethod: pdfCanonical?.extractionMethod || PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_EXTRACTION_METHOD,
      extractedText: pdfCanonical?.canonicalText || '',
    },
  ])
}

function parseArgs(argv = []) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--doc') values.docPath = argv[++index]
    else if (arg === '--docx') values.docxPath = argv[++index]
    else if (arg === '--pdf') values.pdfPath = argv[++index]
  }
  return values
}

async function main() {
  try {
    const report = await runExtractionEquivalenceFromLocalFixtures(parseArgs(process.argv.slice(2)))
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error(JSON.stringify({
      diagnostic: 'resume_format_equivalence_local_staging_only',
      localStagingOnly: true,
      error: ['missing_required_fixture_path', 'semantic_doc_scoring_not_selected'].includes(error?.message) ? error.message : 'diagnostic_failed',
      selectedExtractionMethod: error?.selectedExtractionMethod || null,
      safeFallbackReason: error?.safeFallbackReason || null,
    }))
    process.exitCode = 1
  }
}

if (isDirectExecution()) {
  await main()
}
