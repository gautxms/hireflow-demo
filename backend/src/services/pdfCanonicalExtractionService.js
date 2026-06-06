import { Buffer } from 'node:buffer'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import {
  buildResumeTextFingerprint,
  normalizeResumeTextForFingerprint,
} from './resumeTextFingerprint.js'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const PDF_MAGIC = Buffer.from('%PDF', 'ascii')
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 1500
const DEFAULT_MAX_PAGES = 20
const PDFJS_PACKAGE_VERSION = '5.4.394'
const PDFJS_IMPORT_TARGET = 'pdfjs-dist/legacy/build/pdf.mjs'
const EXTRACTION_METHOD = 'pdfjs_dist_text_content_observe_only'
const SECTION_MARKERS = ['summary', 'skills', 'experience', 'education', 'certification', 'projects']
const CATEGORY = {
  usable: 'usable_text_extraction',
  lowDensity: 'low_text_density',
  scanned: 'likely_scanned_pdf',
  noise: 'suspicious_noise',
  malformed: 'malformed_pdf',
  timeout: 'parser_timeout',
  error: 'parser_error',
}

let pdfJsClient = null
let pdfJsClientOverrideForTests = undefined

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return 0
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

function getLines(text = '') {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function isPrintableOrWhitespace(char) {
  if (!char) return false
  if (/\s/u.test(char)) return true
  const codePoint = char.codePointAt(0)
  return codePoint >= 0x20 && codePoint !== 0x7f && codePoint !== 0xfffd
}

function isSuspiciousNoise(char) {
  if (!char) return false
  const codePoint = char.codePointAt(0)
  if (codePoint === 0xfffd || codePoint === 0x00 || codePoint === 0x7f) return true
  return codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)
}

function calculatePdfSafeTextQualityMetrics(text = '', expectedMarkers = []) {
  const safeText = String(text || '')
  const chars = [...safeText]
  const lines = getLines(safeText)
  const normalizedText = safeText.toLowerCase()
  const normalizedMarkers = expectedMarkers.map((marker) => String(marker || '').trim()).filter(Boolean)
  const markersFound = normalizedMarkers.filter((marker) => normalizedText.includes(marker.toLowerCase()))
  const duplicateLineCount = Math.max(0, lines.length - new Set(lines.map((line) => line.toLowerCase())).size)
  const printableCount = chars.filter(isPrintableOrWhitespace).length
  const suspiciousCount = chars.filter(isSuspiciousNoise).length

  return {
    extractedTextLength: safeText.length,
    lineCount: lines.length,
    printableRatio: chars.length > 0 ? round(printableCount / chars.length) : 0,
    duplicateLineRatio: lines.length > 0 ? round(duplicateLineCount / lines.length) : 0,
    suspiciousNoiseRatio: chars.length > 0 ? round(suspiciousCount / chars.length) : 0,
    safeMarkerCoverage: {
      expected: normalizedMarkers.length,
      found: markersFound.length,
      ratio: normalizedMarkers.length > 0 ? round(markersFound.length / normalizedMarkers.length) : 1,
    },
  }
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
}

export function isPdfCanonicalExtractionObserveOnlyEnabled(env = process.env) {
  return TRUE_VALUES.has(String(env?.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED || '').trim().toLowerCase())
}

export function getPdfCanonicalExtractionObserveOnlyLimits(env = process.env) {
  return {
    maxBytes: normalizePositiveInteger(env?.PDF_CANONICAL_EXTRACTION_MAX_BYTES, DEFAULT_MAX_BYTES),
    timeoutMs: normalizePositiveInteger(env?.PDF_CANONICAL_EXTRACTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxPages: normalizePositiveInteger(env?.PDF_CANONICAL_EXTRACTION_MAX_PAGES, DEFAULT_MAX_PAGES),
  }
}

export function __setPdfJsClientForTests(client) {
  pdfJsClientOverrideForTests = client
  pdfJsClient = null
}

export function __resetPdfJsClientForTests() {
  pdfJsClientOverrideForTests = undefined
  pdfJsClient = null
}

function createTimeoutError() {
  const error = new Error('parser_timeout')
  error.category = CATEGORY.timeout
  return error
}

function createDependencyError(error) {
  const dependencyError = new Error('pdfjs_dependency_missing', error ? { cause: error } : undefined)
  dependencyError.category = CATEGORY.error
  return dependencyError
}

function hasPdfMagic(fileBuffer) {
  return Buffer.isBuffer(fileBuffer) && fileBuffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
}

function buildErrorFingerprint(error) {
  const normalized = String(error?.message || error?.category || 'unknown').trim().toLowerCase()
  return createHash('sha256').update(`pdf-observe-error-v1:${normalized}`).digest('hex').slice(0, 16)
}

async function getPdfJsClient() {
  if (pdfJsClientOverrideForTests !== undefined) {
    if (!pdfJsClientOverrideForTests) {
      throw createDependencyError()
    }
    return pdfJsClientOverrideForTests
  }

  if (pdfJsClient) {
    return pdfJsClient
  }

  try {
    const pdfjsModule = await import(PDFJS_IMPORT_TARGET)
    if (!pdfjsModule || typeof pdfjsModule.getDocument !== 'function') {
      throw new Error('pdfjs_get_document_unavailable')
    }
    if (pdfjsModule.GlobalWorkerOptions) {
      pdfjsModule.GlobalWorkerOptions.workerSrc = ''
    }
    pdfJsClient = pdfjsModule
    return pdfJsClient
  } catch (error) {
    throw createDependencyError(error)
  }
}

async function withTimeout(promise, timeoutMs, onTimeout = null) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (typeof onTimeout === 'function') onTimeout()
      reject(createTimeoutError())
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId)
  }
}

function assertBeforeDeadline(deadline) {
  if (performance.now() > deadline) {
    throw createTimeoutError()
  }
}

function getTextItemPosition(item = {}) {
  const transform = Array.isArray(item.transform) ? item.transform : []
  return {
    text: String(item.str || '').normalize('NFKC'),
    x: Number.isFinite(Number(transform[4])) ? Number(transform[4]) : 0,
    y: Number.isFinite(Number(transform[5])) ? Number(transform[5]) : 0,
    width: Number.isFinite(Number(item.width)) ? Number(item.width) : 0,
    height: Number.isFinite(Number(item.height)) ? Number(item.height) : Math.abs(Number(transform[3] || 0)) || 10,
  }
}

function buildLayoutAwarePageText(items = [], deadline) {
  const positionedItems = items
    .map(getTextItemPosition)
    .filter((item) => item.text.trim())
    .sort((left, right) => {
      const yDelta = right.y - left.y
      if (Math.abs(yDelta) > Math.max(3, Math.min(left.height || 10, right.height || 10) * 0.5)) return yDelta
      return left.x - right.x
    })

  const lines = []
  for (const item of positionedItems) {
    assertBeforeDeadline(deadline)
    const currentLine = lines.at(-1)
    const tolerance = Math.max(3, Math.min(item.height || 10, currentLine?.height || item.height || 10) * 0.6)
    if (!currentLine || Math.abs(currentLine.y - item.y) > tolerance) {
      lines.push({ y: item.y, height: item.height || 10, items: [item] })
    } else {
      currentLine.items.push(item)
      currentLine.height = Math.max(currentLine.height, item.height || 10)
    }
  }

  return lines
    .map((line) => line.items
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n')
}

async function extractTextWithPdfJs(fileBuffer, { timeoutMs, maxPages }) {
  const pdfjs = await getPdfJsClient()
  const parserVersion = String(pdfjs.version || PDFJS_PACKAGE_VERSION)
  let loadingTask = null
  let pdfDocument = null
  const deadline = performance.now() + timeoutMs

  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: false,
      disableFontFace: true,
    })
    pdfDocument = await withTimeout(Promise.resolve(loadingTask.promise), timeoutMs, () => loadingTask?.destroy?.())
    const pageCount = Number.isFinite(Number(pdfDocument.numPages)) ? Number(pdfDocument.numPages) : null
    const pagesToRead = Math.min(pageCount || 0, maxPages)
    const pageTexts = []

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      assertBeforeDeadline(deadline)
      const remainingMs = Math.max(1, Math.floor(deadline - performance.now()))
      const page = await withTimeout(Promise.resolve(pdfDocument.getPage(pageNumber)), remainingMs)
      assertBeforeDeadline(deadline)
      const textContent = await withTimeout(Promise.resolve(page.getTextContent({ includeMarkedContent: false })), remainingMs)
      const items = Array.isArray(textContent?.items) ? textContent.items : []
      pageTexts.push(buildLayoutAwarePageText(items, deadline))
      page?.cleanup?.()
    }

    return {
      extractedText: pageTexts.filter(Boolean).join('\n').trim(),
      pageCount,
      pagesRead: pagesToRead,
      parserVersion,
    }
  } finally {
    await Promise.resolve(pdfDocument?.destroy?.()).catch(() => {})
    await Promise.resolve(loadingTask?.destroy?.()).catch(() => {})
  }
}

function classifyPdfExtraction({ text, metrics, byteSize, pageCount }) {
  const textLength = String(text || '').length
  const pages = Number.isFinite(Number(pageCount)) && Number(pageCount) > 0 ? Number(pageCount) : 1
  const textDensity = byteSize > 0 ? textLength / byteSize : 0
  const charsPerPage = textLength / pages
  const ocrRequired = textLength < 80 || charsPerPage < 80

  if (textLength === 0 || charsPerPage < 20) {
    return { qualityClassification: CATEGORY.scanned, ocrRequired: true }
  }
  if (metrics.suspiciousNoiseRatio > 0.05 || metrics.printableRatio < 0.92) {
    return { qualityClassification: CATEGORY.noise, ocrRequired }
  }
  if (textLength < 200 || charsPerPage < 120 || textDensity < 0.01) {
    return { qualityClassification: CATEGORY.lowDensity, ocrRequired }
  }
  return { qualityClassification: CATEGORY.usable, ocrRequired: false }
}

function buildFailureResult({ category, startedAt, fileBuffer, error = null, parserVersion = PDFJS_PACKAGE_VERSION }) {
  return {
    enabled: true,
    success: false,
    extractionMethod: EXTRACTION_METHOD,
    parserVersion,
    durationMs: round(performance.now() - startedAt, 2),
    inputByteSize: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0,
    pageCount: null,
    pagesRead: 0,
    lineCount: 0,
    extractedTextLength: 0,
    canonicalTextLength: 0,
    normalizedFingerprint: null,
    normalizedTextCharCount: 0,
    normalizedTextLineCount: 0,
    printableRatio: 0,
    suspiciousNoiseRatio: 0,
    duplicateLineRatio: 0,
    safeSectionMarkerCoverage: { expected: SECTION_MARKERS.length, found: 0, ratio: 0 },
    qualityClassification: category,
    ocrRequired: category === CATEGORY.scanned,
    failureCategory: category,
    errorFingerprint: error ? buildErrorFingerprint(error) : null,
  }
}

export async function observePdfCanonicalTextExtraction(fileBuffer, options = {}) {
  const { env = process.env } = options || {}
  const startedAt = performance.now()
  const limits = getPdfCanonicalExtractionObserveOnlyLimits(env)

  try {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0 || !hasPdfMagic(fileBuffer)) {
      return buildFailureResult({ category: CATEGORY.malformed, startedAt, fileBuffer })
    }
    if (fileBuffer.length > limits.maxBytes) {
      return buildFailureResult({ category: CATEGORY.error, startedAt, fileBuffer, error: new Error('file_too_large') })
    }

    const extraction = await withTimeout(
      extractTextWithPdfJs(fileBuffer, limits),
      limits.timeoutMs,
    )
    const canonicalText = normalizeResumeTextForFingerprint(extraction.extractedText)
    const fingerprint = buildResumeTextFingerprint(canonicalText)
    const metrics = calculatePdfSafeTextQualityMetrics(canonicalText, SECTION_MARKERS)
    const classification = classifyPdfExtraction({ text: canonicalText, metrics, byteSize: fileBuffer.length, pageCount: extraction.pageCount })

    return {
      enabled: true,
      success: true,
      extractionMethod: EXTRACTION_METHOD,
      parserVersion: extraction.parserVersion || PDFJS_PACKAGE_VERSION,
      durationMs: round(performance.now() - startedAt, 2),
      inputByteSize: fileBuffer.length,
      pageCount: extraction.pageCount,
      pagesRead: extraction.pagesRead,
      lineCount: metrics.lineCount,
      extractedTextLength: String(extraction.extractedText || '').length,
      canonicalTextLength: canonicalText.length,
      normalizedFingerprint: fingerprint?.sha256 || null,
      normalizedTextCharCount: fingerprint?.normalizedCharCount || 0,
      normalizedTextLineCount: fingerprint?.normalizedLineCount || 0,
      printableRatio: metrics.printableRatio,
      suspiciousNoiseRatio: metrics.suspiciousNoiseRatio,
      duplicateLineRatio: metrics.duplicateLineRatio,
      safeSectionMarkerCoverage: metrics.safeMarkerCoverage,
      qualityClassification: classification.qualityClassification,
      ocrRequired: classification.ocrRequired,
      failureCategory: null,
    }
  } catch (error) {
    const category = error?.category === CATEGORY.timeout ? CATEGORY.timeout : CATEGORY.error
    return buildFailureResult({ category, startedAt, fileBuffer, error })
  }
}

export function logSafePdfCanonicalExtractionDiagnostics(logger, diagnostics) {
  const target = diagnostics?.success ? (logger?.info || logger?.log) : (logger?.warn || logger?.log)
  if (typeof target === 'function') {
    target.call(logger, '[ResumeDiagnostics] pdf_canonical_extraction_observe_only', diagnostics)
  }
}

export const PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_CATEGORIES = CATEGORY
export const PDF_CANONICAL_EXTRACTION_PARSER_METADATA = {
  packageName: 'pdfjs-dist',
  packageVersion: PDFJS_PACKAGE_VERSION,
  importTarget: PDFJS_IMPORT_TARGET,
  extractionMethod: EXTRACTION_METHOD,
}
