#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import process from 'node:process'

import {
  buildResumeTextFingerprint,
  normalizeResumeTextForFingerprint,
  prepareResumePayloadForAnalysis,
} from '../src/services/resumeDocumentExtractionService.js'
import {
  PDF_CANONICAL_TEXT_SCORING_EXPERIMENT_EXTRACTION_METHOD,
  extractPdfCanonicalTextForInternalUse,
} from '../src/services/pdfCanonicalExtractionService.js'
import { calculateSafeTextQualityMetrics } from '../src/services/resumeFormatDiagnosticHarness.js'

const DOC_MIME_TYPE = 'application/msword'
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const QUIET_LOGGER = { debug() {}, info() {}, warn() {}, log() {}, error() {} }
const FORMAT_LABELS = ['doc', 'docx', 'pdf']
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_PATTERN = /(?:\+?\d[\d().\-\s]{7,}\d)/g

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

export function buildSafeLineFingerprintSummary(text = '') {
  const lines = normalizedLines(text)
  const orderedFingerprint = buildResumeTextFingerprint(text)
  const sortedLines = [...lines].sort()
  const uniqueLines = [...new Set(sortedLines)]
  const lineHashes = lines.map((line) => buildNamespacedSha256(line, 'resume-local-diagnostic-line-v1'))
  const uniqueLineHashes = new Set(lineHashes)
  const redactedLineCount = lines.filter((line) => hasEmail(line) || hasPhone(line)).length

  return {
    normalizedCharCount: orderedFingerprint.normalizedCharCount || 0,
    normalizedLineCount: orderedFingerprint.normalizedLineCount || 0,
    orderedNormalizedFingerprint: orderedFingerprint.sha256 || null,
    sortedLineMultisetFingerprint: lines.length ? fingerprintLines(sortedLines, 'resume-local-diagnostic-sorted-line-multiset-v1') : null,
    uniqueLineSetFingerprint: uniqueLines.length ? fingerprintLines(uniqueLines, 'resume-local-diagnostic-unique-line-set-v1') : null,
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
    note: 'Safe aggregate diagnostics only; raw text, filenames, paths, and PII are intentionally omitted.',
    formats: extractions.map((extraction) => {
      const summary = summariesByFormat[extraction.formatLabel] || buildSafeLineFingerprintSummary('')
      const quality = calculateSafeTextQualityMetrics(extraction.extractedText || '')
      const { lineHashSet: _lineHashSet, ...safeSummary } = summary
      return {
        formatLabel: extraction.formatLabel,
        extractionMethod: extraction.extractionMethod || null,
        ...safeSummary,
        printableRatio: quality.printableRatio,
        suspiciousNoiseRatio: quality.suspiciousNoiseRatio,
        duplicateLineRatio: quality.duplicateLineRatio,
        ...onlyInCounts,
      }
    }),
    aggregateOnlyInFormatHashCounts: onlyInCounts,
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

async function extractViaPreparedPayload({ buffer, mimeType, syntheticFilename }) {
  const prepared = await prepareResumePayloadForAnalysis({
    fileBufferBase64: Buffer.from(buffer).toString('base64'),
    mimeType,
    originalMimeType: mimeType,
    filename: syntheticFilename,
    fileSize: buffer.length,
    logger: QUIET_LOGGER,
    diagnosticsContext: {},
  })
  return {
    extractedText: String(prepared?.extractedText || ''),
    extractionMethod: prepared?.diagnostics?.extractionMethod || prepared?.extractionMethod || null,
  }
}

export async function runExtractionEquivalenceFromLocalFixtures({ docPath, docxPath, pdfPath } = {}) {
  const [docBuffer, docxBuffer, pdfBuffer] = await Promise.all([
    readRequiredFixture(docPath),
    readRequiredFixture(docxPath),
    readRequiredFixture(pdfPath),
  ])

  const [doc, docx, pdfCanonical] = await Promise.all([
    extractViaPreparedPayload({ buffer: docBuffer, mimeType: DOC_MIME_TYPE, syntheticFilename: 'synthetic-local-diagnostic.doc' }),
    extractViaPreparedPayload({ buffer: docxBuffer, mimeType: DOCX_MIME_TYPE, syntheticFilename: 'synthetic-local-diagnostic.docx' }),
    extractPdfCanonicalTextForInternalUse(pdfBuffer),
  ])

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
      error: error?.message === 'missing_required_fixture_path' ? 'missing_required_fixture_path' : 'diagnostic_failed',
    }))
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
